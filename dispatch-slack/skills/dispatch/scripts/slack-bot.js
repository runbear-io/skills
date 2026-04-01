const { App } = require("@slack/bolt");
const { WebClient } = require("@slack/web-api");
const { query } = require("@anthropic-ai/claude-agent-sdk");
const { TokenManager } = require("./token-manager");

// Track sessions per Slack thread (channel:thread_ts -> sessionId)
const threadSessions = new Map();

// Throttle interval for stream appends (ms)
const STREAM_APPEND_INTERVAL = 300;

function createSlackBot({ tokenManager, teamId, botToken, cwd }) {
  const token = botToken
    ? botToken
    : async () => tokenManager.getAccessToken(teamId);

  const app = new App({
    signingSecret: process.env.SLACK_SIGNING_SECRET,
    token,
    appToken: process.env.SLACK_APP_TOKEN,
    socketMode: !!process.env.SLACK_APP_TOKEN,
  });

  // Resolve teamId from auth.test if not provided (direct bot token mode)
  let resolvedTeamId = teamId || null;
  app.use(async ({ client, next }) => {
    if (!resolvedTeamId) {
      try {
        const auth = await client.auth.test();
        resolvedTeamId = auth.team_id;
        console.log(`Resolved team ID: ${resolvedTeamId}`);
      } catch (err) {
        console.error("Failed to resolve team ID:", err.message);
      }
    }
    await next();
  });

  // Respond to messages that mention the bot or are in DMs
  app.event("app_mention", async ({ event, say, client }) => {
    await handleMessage(event, say, client, { teamId: resolvedTeamId, cwd });
  });

  app.event("message", async ({ event, say, client }) => {
    // Only respond to DMs (not channels — use app_mention for that)
    if (event.channel_type === "im" && !event.bot_id) {
      await handleMessage(event, say, client, { teamId: resolvedTeamId, cwd });
    }
  });

  return app;
}

async function handleMessage(event, say, client, { teamId, cwd }) {
  const threadTs = event.thread_ts || event.ts;
  const threadKey = `${event.channel}:${threadTs}`;
  const prompt = (event.text || "").replace(/<@[A-Z0-9]+>/g, "").trim();

  if (!prompt) return;

  // Start a Slack stream for the response
  let streamTs = null;
  let useStreaming = false;
  try {
    const stream = await client.chat.startStream({
      channel: event.channel,
      thread_ts: threadTs,
      ...(teamId ? { recipient_team_id: teamId } : {}),
      ...(event.channel_type !== "im" && event.user ? { recipient_user_id: event.user } : {}),
    });
    streamTs = stream.ts;
    useStreaming = true;
  } catch (streamErr) {
    console.log("Streaming not available, falling back to regular messages:", streamErr.message);
  }

  let fullText = "";
  let flushedLength = 0;
  let lastAppendTime = 0;
  let pendingAppend = null;

  const flushDelta = async () => {
    if (!useStreaming) return;
    const delta = fullText.slice(flushedLength);
    if (!delta) return;
    flushedLength = fullText.length;
    try {
      await client.chat.appendStream({
        channel: event.channel,
        ts: streamTs,
        markdown_text: delta,
      });
    } catch (err) {
      console.error("Stream append error:", err.message);
    }
  };

  const appendToStream = async (newFullText) => {
    fullText = newFullText;
    if (!useStreaming) return;
    const now = Date.now();
    const timeSinceLastAppend = now - lastAppendTime;

    if (timeSinceLastAppend >= STREAM_APPEND_INTERVAL) {
      if (pendingAppend) {
        clearTimeout(pendingAppend);
        pendingAppend = null;
      }
      lastAppendTime = now;
      await flushDelta();
    } else if (!pendingAppend) {
      const delay = STREAM_APPEND_INTERVAL - timeSinceLastAppend;
      pendingAppend = setTimeout(async () => {
        pendingAppend = null;
        lastAppendTime = Date.now();
        await flushDelta();
      }, delay);
    }
  };

  try {
    let sessionId = threadSessions.get(threadKey);
    let newSessionId = null;

    const options = {
      allowedTools: ["Read", "Edit", "Write", "Bash", "Glob", "Grep"],
      permissionMode: "bypassPermissions",
      allowDangerouslySkipPermissions: true,
      settingSources: ["project", "user"],
    };

    if (sessionId) options.resume = sessionId;
    if (cwd || process.env.CLAUDE_CWD) options.cwd = cwd || process.env.CLAUDE_CWD;

    const slackHints = [
      "You are responding in Slack. Use Slack mrkdwn format, NOT standard Markdown.",
      "Slack mrkdwn rules:",
      "- Bold: *text* (not **text**)",
      "- Italic: _text_ (not *text*)",
      "- Strikethrough: ~text~",
      "- Code: `code` and ```code blocks```",
      "- Links: <https://example.com|link text>",
      "- Lists: use plain bullet characters or numbers, no markdown list syntax",
      "- Blockquote: > text",
      "- Slack does NOT support headings (#), tables, or images in mrkdwn.",
      "- For tabular data, use code blocks with aligned text.",
      "Keep responses concise.",
    ].join("\n");

    const userPrompt = process.env.CLAUDE_SYSTEM_PROMPT || "";
    options.systemPrompt = userPrompt
      ? `${userPrompt}\n\n${slackHints}`
      : slackHints;

    // Track thinking state and final (non-thinking) text separately
    let inThinking = false;
    let finalText = ""; // Text without thinking — used for the final message

    const processStream = async (queryOptions) => {
      for await (const message of query({ prompt, options: queryOptions })) {
        if (message.type === "system" && message.subtype === "init") {
          newSessionId = message.session_id;
        }

        if (message.type === "assistant" && message.message?.content) {
          for (const block of message.message.content) {
            // Thinking block — stream live but don't include in finalText
            if (block.type === "thinking" && block.thinking) {
              const thinkingText = block.thinking.trim();
              if (thinkingText) {
                const lines = thinkingText.split("\n").map(l => `> _${l}_`).join("\n");
                if (!inThinking) {
                  fullText += (fullText ? "\n" : "") + "> :thought_balloon: *Thinking...*\n";
                  inThinking = true;
                }
                fullText += lines + "\n";
                await appendToStream(fullText);
              }
            }

            // Tool use — show inline (include in both)
            if ("name" in block && block.type === "tool_use") {
              if (inThinking) {
                fullText += "\n";
                inThinking = false;
              }
              const toolDesc = describeToolUse(block);
              fullText += (fullText ? "\n" : "") + toolDesc + "\n";
              finalText += (finalText ? "\n" : "") + toolDesc + "\n";
              await appendToStream(fullText);
            }

            // Text — main response
            if ("text" in block && block.type === "text") {
              if (inThinking) {
                fullText += "\n";
                inThinking = false;
              }
              const converted = markdownToMrkdwn(block.text);
              fullText += (fullText ? "\n" : "") + converted;
              finalText += (finalText ? "\n" : "") + converted;
              await appendToStream(fullText);
            }
          }
        }
      }
    };

    try {
      await processStream(options);
    } catch (err) {
      // If session resume failed, retry without resuming
      if (sessionId && err.message && err.message.includes("session")) {
        console.log(`Session ${sessionId} not found, starting fresh`);
        threadSessions.delete(threadKey);
        delete options.resume;
        fullText = "";
        finalText = "";
        flushedLength = 0;
        inThinking = false;
        await processStream(options);
      } else {
        throw err;
      }
    }

    // Flush any pending append
    if (pendingAppend) {
      clearTimeout(pendingAppend);
      pendingAppend = null;
    }

    if (newSessionId) {
      threadSessions.set(threadKey, newSessionId);
    }

    if (useStreaming) {
      // Stop the stream first
      const remainingDelta = fullText.slice(flushedLength);
      await client.chat.stopStream({
        channel: event.channel,
        ts: streamTs,
        ...(remainingDelta || !flushedLength
          ? { markdown_text: remainingDelta || "No response generated." }
          : {}),
      });
      // Replace the streamed message with finalText (thinking removed)
      if (finalText && finalText !== fullText) {
        try {
          await client.chat.update({
            channel: event.channel,
            ts: streamTs,
            text: finalText,
          });
        } catch (err) {
          console.error("Failed to update message to remove thinking:", err.message);
        }
      }
    } else {
      // Fallback: post finalText as a regular message (no thinking)
      await say({
        text: finalText || "No response generated.",
        thread_ts: threadTs,
      });
    }
  } catch (err) {
    console.error("Slack handler error:", err);
    if (useStreaming && streamTs) {
      try {
        await client.chat.stopStream({
          channel: event.channel,
          ts: streamTs,
          markdown_text: `:x: Error: ${err.message}`,
        });
      } catch (stopErr) {
        console.error("Stream stop error:", stopErr.message);
      }
    } else {
      await say({
        text: `:x: Error: ${err.message}`,
        thread_ts: threadTs,
      });
    }
  }
}

function describeToolUse(block) {
  const input = block.input || {};
  switch (block.name) {
    case "Read":
      return `:mag: Reading \`${shortenPath(input.file_path)}\``;
    case "Write":
      return `:pencil: Writing \`${shortenPath(input.file_path)}\``;
    case "Edit":
      return `:pencil2: Editing \`${shortenPath(input.file_path)}\``;
    case "Glob":
      return `:open_file_folder: Searching files matching \`${input.pattern || "..."}\``;
    case "Grep":
      return `:mag_right: Searching for \`${truncate(input.pattern, 40)}\``;
    case "Bash": {
      const cmd = truncate((input.command || "").split("\n")[0], 60);
      return `:gear: Running \`${cmd}\``;
    }
    case "WebSearch":
      return `:globe_with_meridians: Searching the web for \`${truncate(input.query, 50)}\``;
    case "WebFetch":
      return `:globe_with_meridians: Fetching \`${truncate(input.url, 60)}\``;
    case "Agent":
      return `:robot_face: Spawning agent: ${truncate(input.description || input.prompt, 50)}`;
    case "NotebookEdit":
      return `:notebook: Editing notebook \`${shortenPath(input.notebook_path)}\``;
    default: {
      const detail = input.query || input.prompt || input.pattern || input.url || input.file_path;
      if (detail) return `:wrench: ${block.name}: \`${truncate(String(detail), 50)}\``;
      return `:wrench: ${block.name}`;
    }
  }
}

function shortenPath(filePath) {
  if (!filePath) return "...";
  const parts = filePath.split("/");
  if (parts.length <= 3) return filePath;
  return ".../" + parts.slice(-2).join("/");
}

function truncate(str, max) {
  if (!str) return "...";
  return str.length > max ? str.slice(0, max - 1) + "…" : str;
}

/**
 * Convert standard Markdown to Slack mrkdwn format.
 */
function markdownToMrkdwn(text) {
  let result = text;

  // Convert markdown links [text](url) → <url|text>
  result = result.replace(/\[([^\]]+)\]\(([^)]+)\)/g, "<$2|$1>");

  // Convert bold/headings/strikethrough outside code blocks
  result = convertOutsideCode(result, (segment) => {
    segment = segment.replace(/\*\*(.+?)\*\*/g, "*$1*");
    segment = segment.replace(/^#{1,6}\s+(.+)$/gm, "*$1*");
    segment = segment.replace(/~~(.+?)~~/g, "~$1~");
    return segment;
  });

  return result;
}

/**
 * Apply a transform function only to text outside of code blocks/inline code.
 */
function convertOutsideCode(text, transform) {
  const parts = text.split(/(```[\s\S]*?```|`[^`]+`)/g);
  return parts
    .map((part, i) => {
      if (i % 2 === 1) return part;
      return transform(part);
    })
    .join("");
}

module.exports = { createSlackBot };
