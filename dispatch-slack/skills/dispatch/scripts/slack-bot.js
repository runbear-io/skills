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

  // Respond to messages that mention the bot or are in DMs
  app.event("app_mention", async ({ event, say, client }) => {
    await handleMessage(event, say, client, { tokenManager, teamId, botToken, cwd });
  });

  app.event("message", async ({ event, say, client }) => {
    // Only respond to DMs (not channels — use app_mention for that)
    if (event.channel_type === "im" && !event.bot_id) {
      await handleMessage(event, say, client, { tokenManager, teamId, botToken, cwd });
    }
  });

  return app;
}

async function handleMessage(event, say, client, { tokenManager, teamId, botToken, cwd }) {
  const threadTs = event.thread_ts || event.ts;
  const threadKey = `${event.channel}:${threadTs}`;
  const prompt = event.text.replace(/<@[A-Z0-9]+>/g, "").trim();

  if (!prompt) return;

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

    // Post a status message that will be updated during tool use
    const statusMsg = await say({
      text: ":hourglass_flowing_sand: Working on it...",
      thread_ts: threadTs,
    });
    const statusTs = statusMsg.ts;

    // Start a Slack stream for the actual response
    const stream = await client.chat.startStream({
      channel: event.channel,
      thread_ts: threadTs,
    });
    const streamTs = stream.ts;

    let fullText = "";
    let flushedLength = 0;
    let lastAppendTime = 0;
    let pendingAppend = null;
    let lastToolStatus = "";
    let displayPhase = "init";
    let activityTimer = null;
    let phaseStartTime = Date.now();
    let activityTick = 0;
    let statusDeleted = false;
    const REPHRASE_INTERVAL = 5000;

    const updateStatus = async (text) => {
      if (statusDeleted) return;
      try {
        await client.chat.update({
          channel: event.channel,
          ts: statusTs,
          text,
        });
      } catch (err) {
        console.error("Status update error:", err.message);
      }
    };

    const deleteStatus = async () => {
      if (statusDeleted) return;
      statusDeleted = true;
      clearActivityTimer();
      try {
        await client.chat.delete({
          channel: event.channel,
          ts: statusTs,
        });
      } catch (err) {
        console.error("Status delete error:", err.message);
      }
    };

    const resetActivityTimer = () => {
      clearActivityTimer();
      phaseStartTime = Date.now();
      activityTick = 0;
      activityTimer = setInterval(async () => {
        activityTick++;
        const elapsed = Math.round((Date.now() - phaseStartTime) / 1000);
        const prefix = getStillWorkingPrefix(activityTick, elapsed);
        if (displayPhase === "tool") {
          await updateStatus(`${prefix}\n${lastToolStatus}`);
        } else {
          await updateStatus(prefix);
        }
      }, REPHRASE_INTERVAL);
    };

    const clearActivityTimer = () => {
      if (activityTimer) {
        clearInterval(activityTimer);
        activityTimer = null;
      }
    };

    // Start the timer so the initial status doesn't go stale
    resetActivityTimer();

    const flushDelta = async () => {
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

    const appendToStream = async (text) => {
      fullText = text;
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

    const processStream = async (queryOptions) => {
      for await (const message of query({ prompt, options: queryOptions })) {
        if (message.type === "system" && message.subtype === "init") {
          newSessionId = message.session_id;
        }

        if (message.type === "assistant" && message.message?.content) {
          for (const block of message.message.content) {
            // Tool use — update status message
            if ("name" in block) {
              displayPhase = "tool";
              lastToolStatus = describeToolUse(block);
              await updateStatus(`:hourglass_flowing_sand: Working on it...\n${lastToolStatus}`);
              resetActivityTimer();
            }

            // Text — stream to the response, delete status when first text arrives
            if ("text" in block) {
              if (!statusDeleted) {
                await deleteStatus();
              }
              displayPhase = "text";
              await appendToStream(markdownToMrkdwn(block.text));
            }
          }
        }
      }
      clearActivityTimer();
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
        flushedLength = 0;
        displayPhase = "init";
        resetActivityTimer();
        await processStream(options);
      } else {
        throw err;
      }
    }

    // Clean up status message if still visible
    await deleteStatus();

    // Flush any pending append
    if (pendingAppend) {
      clearTimeout(pendingAppend);
      pendingAppend = null;
    }

    if (newSessionId) {
      threadSessions.set(threadKey, newSessionId);
    }

    // Send any remaining unflushed text as the final delta, then stop the stream
    const remainingDelta = fullText.slice(flushedLength);
    await client.chat.stopStream({
      channel: event.channel,
      ts: streamTs,
      ...(remainingDelta || !flushedLength
        ? { markdown_text: remainingDelta || "No response generated." }
        : {}),
    });
  } catch (err) {
    clearActivityTimer();
    await deleteStatus();
    console.error("Slack handler error:", err);
    await say({
      text: `:x: Error: ${err.message}`,
      thread_ts: threadTs,
    });
  }
}

const STILL_WORKING_PREFIXES = [
  ":hourglass_flowing_sand: Still working on it…",
  ":hourglass: Hang tight, still going…",
  ":hourglass_flowing_sand: Taking a moment…",
  ":hourglass: Still at it…",
  ":hourglass_flowing_sand: Almost there, still processing…",
  ":hourglass: Working through this…",
  ":hourglass_flowing_sand: Bear with me…",
  ":hourglass: Still crunching…",
];

function getStillWorkingPrefix(tick, elapsedSec) {
  const idx = (tick - 1) % STILL_WORKING_PREFIXES.length;
  return `${STILL_WORKING_PREFIXES[idx]} (${elapsedSec}s)`;
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
 * Handles the most common patterns Claude might produce.
 */
function markdownToMrkdwn(text) {
  let result = text;

  // Convert markdown links [text](url) → <url|text>
  result = result.replace(/\[([^\]]+)\]\(([^)]+)\)/g, "<$2|$1>");

  // Convert bold **text** → *text* (but not inside code blocks)
  // Process outside code blocks only
  result = convertOutsideCode(result, (segment) => {
    // Bold: **text** → *text*
    segment = segment.replace(/\*\*(.+?)\*\*/g, "*$1*");
    // Headings: # text → *text* (bold)
    segment = segment.replace(/^#{1,6}\s+(.+)$/gm, "*$1*");
    // Strikethrough: ~~text~~ → ~text~
    segment = segment.replace(/~~(.+?)~~/g, "~$1~");
    return segment;
  });

  return result;
}

/**
 * Apply a transform function only to text outside of code blocks/inline code.
 */
function convertOutsideCode(text, transform) {
  // Split by code blocks (``` ... ```) and inline code (` ... `)
  const parts = text.split(/(```[\s\S]*?```|`[^`]+`)/g);
  return parts
    .map((part, i) => {
      // Odd indices are code blocks/inline code — leave them alone
      if (i % 2 === 1) return part;
      return transform(part);
    })
    .join("");
}

module.exports = { createSlackBot };
