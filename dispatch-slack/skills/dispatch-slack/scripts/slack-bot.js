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
    if (process.env.CLAUDE_SYSTEM_PROMPT)
      options.systemPrompt = process.env.CLAUDE_SYSTEM_PROMPT;

    // Start a Slack stream
    const stream = await client.chat.startStream({
      channel: event.channel,
      thread_ts: threadTs,
    });
    const streamTs = stream.ts;

    let fullText = "";
    let lastAppendTime = 0;
    let pendingAppend = null;

    const appendToStream = async (text) => {
      fullText = text;
      const now = Date.now();
      const timeSinceLastAppend = now - lastAppendTime;

      if (timeSinceLastAppend >= STREAM_APPEND_INTERVAL) {
        // Enough time has passed, append immediately
        if (pendingAppend) {
          clearTimeout(pendingAppend);
          pendingAppend = null;
        }
        lastAppendTime = now;
        try {
          await client.chat.appendStream({
            channel: event.channel,
            ts: streamTs,
            markdown_text: fullText,
          });
        } catch (err) {
          console.error("Stream append error:", err.message);
        }
      } else if (!pendingAppend) {
        // Schedule a deferred append
        const delay = STREAM_APPEND_INTERVAL - timeSinceLastAppend;
        pendingAppend = setTimeout(async () => {
          pendingAppend = null;
          lastAppendTime = Date.now();
          try {
            await client.chat.appendStream({
              channel: event.channel,
              ts: streamTs,
              markdown_text: fullText,
            });
          } catch (err) {
            console.error("Stream append error:", err.message);
          }
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
            if ("text" in block) {
              await appendToStream(block.text);
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

    // Stop the stream with the final text
    await client.chat.stopStream({
      channel: event.channel,
      ts: streamTs,
      markdown_text: fullText || "No response generated.",
    });
  } catch (err) {
    console.error("Slack handler error:", err);
    await say({
      text: `:x: Error: ${err.message}`,
      thread_ts: threadTs,
    });
  }
}

module.exports = { createSlackBot };
