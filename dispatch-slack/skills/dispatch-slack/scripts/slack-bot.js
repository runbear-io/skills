const { App } = require("@slack/bolt");
const { query } = require("@anthropic-ai/claude-agent-sdk");
const { TokenManager } = require("./token-manager");

// Track sessions per Slack thread (channel:thread_ts -> sessionId)
const threadSessions = new Map();

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
  app.event("app_mention", async ({ event, say }) => {
    await handleMessage(event, say, { tokenManager, teamId, botToken, cwd });
  });

  app.event("message", async ({ event, say }) => {
    // Only respond to DMs (not channels — use app_mention for that)
    if (event.channel_type === "im" && !event.bot_id) {
      await handleMessage(event, say, { tokenManager, teamId, botToken, cwd });
    }
  });

  return app;
}

async function handleMessage(event, say, { tokenManager, teamId, botToken, cwd }) {
  const threadTs = event.thread_ts || event.ts;
  const threadKey = `${event.channel}:${threadTs}`;
  const prompt = event.text.replace(/<@[A-Z0-9]+>/g, "").trim();

  if (!prompt) return;

  // Post a thinking indicator
  const thinking = await say({
    text: ":hourglass_flowing_sand: Working on it...",
    thread_ts: threadTs,
  });

  try {
    const messages = [];
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

    try {
      for await (const message of query({ prompt, options })) {
        if (message.type === "system" && message.subtype === "init") {
          newSessionId = message.session_id;
        }

        if (message.type === "assistant" && message.message?.content) {
          for (const block of message.message.content) {
            if ("text" in block) {
              messages.push(block.text);
            }
          }
        }
      }
    } catch (err) {
      // If session resume failed, retry without resuming
      if (sessionId && err.message && err.message.includes("session")) {
        console.log(`Session ${sessionId} not found, starting fresh`);
        threadSessions.delete(threadKey);
        delete options.resume;
        for await (const message of query({ prompt, options })) {
          if (message.type === "system" && message.subtype === "init") {
            newSessionId = message.session_id;
          }
          if (message.type === "assistant" && message.message?.content) {
            for (const block of message.message.content) {
              if ("text" in block) {
                messages.push(block.text);
              }
            }
          }
        }
      } else {
        throw err;
      }
    }

    if (newSessionId) {
      threadSessions.set(threadKey, newSessionId);
    }

    const response = messages[messages.length - 1] || "No response generated.";

    // Slack messages have a 4000 char limit for text
    const chunks = splitMessage(response, 3900);

    // Delete the thinking indicator
    try {
      const tok = botToken
        ? botToken
        : await tokenManager.getAccessToken(teamId);
      const { WebClient } = require("@slack/web-api");
      const client = new WebClient(tok);
      await client.chat.delete({
        channel: event.channel,
        ts: thinking.ts,
      });
    } catch {
      // Ignore if we can't delete (e.g., no permission)
    }

    for (const chunk of chunks) {
      await say({ text: chunk, thread_ts: threadTs });
    }
  } catch (err) {
    console.error("Slack handler error:", err);
    await say({
      text: `:x: Error: ${err.message}`,
      thread_ts: threadTs,
    });
  }
}

function splitMessage(text, maxLength) {
  if (text.length <= maxLength) return [text];

  const chunks = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      chunks.push(remaining);
      break;
    }
    // Try to split at a newline
    let splitIdx = remaining.lastIndexOf("\n", maxLength);
    if (splitIdx === -1 || splitIdx < maxLength / 2) {
      splitIdx = maxLength;
    }
    chunks.push(remaining.slice(0, splitIdx));
    remaining = remaining.slice(splitIdx).replace(/^\n/, "");
  }
  return chunks;
}

module.exports = { createSlackBot };
