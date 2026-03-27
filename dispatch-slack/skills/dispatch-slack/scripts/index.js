const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../.env") });
const express = require("express");
const { query } = require("@anthropic-ai/claude-agent-sdk");
const { TokenManager } = require("./token-manager");
const { createSlackBot } = require("./slack-bot");

const app = express();
app.use(express.json());

// Parse CLI flags
function parseArgs(args) {
  const parsed = {};
  for (let i = 0; i < args.length; i++) {
    const key = args[i].replace(/^--/, "");
    if (key === "port" && args[i + 1]) parsed.port = parseInt(args[++i], 10);
    else if (key === "cwd" && args[i + 1]) parsed.cwd = args[++i];
    else if ((key === "session-id" || key === "sessionId") && args[i + 1])
      parsed.sessionId = args[++i];
  }
  return parsed;
}

const args = parseArgs(process.argv.slice(2));
const PORT = args.port || process.env.PORT || 3000;
const CWD = args.cwd || process.env.CLAUDE_CWD || null;
const SESSION_ID = args.sessionId || process.env.CLAUDE_SESSION_ID || null;

// Health check
app.get("/health", (req, res) => res.json({ ok: true }));

// POST /api/query - Execute a Claude Code prompt and return the response
app.post("/api/query", async (req, res) => {
  const { prompt, cwd, sessionId, allowedTools, systemPrompt } = req.body;

  if (!prompt) {
    return res.status(400).json({ error: "prompt is required" });
  }

  try {
    const messages = [];
    let resultSessionId = null;
    let finalResult = null;

    const options = {
      allowedTools: allowedTools || [
        "Read",
        "Edit",
        "Write",
        "Bash",
        "Glob",
        "Grep",
      ],
      permissionMode: "bypassPermissions",
      allowDangerouslySkipPermissions: true,
      settingSources: ["project", "user"],
    };

    if (cwd || CWD) options.cwd = cwd || CWD;
    if (sessionId || SESSION_ID) options.resume = sessionId || SESSION_ID;
    if (systemPrompt) options.systemPrompt = systemPrompt;

    for await (const message of query({ prompt, options })) {
      if (message.type === "system" && message.subtype === "init") {
        resultSessionId = message.session_id;
      }

      if (message.type === "assistant" && message.message?.content) {
        for (const block of message.message.content) {
          if ("text" in block) {
            messages.push({ type: "text", content: block.text });
          } else if ("name" in block) {
            messages.push({
              type: "tool_use",
              tool: block.name,
              input: block.input,
            });
          }
        }
      }

      if (message.type === "tool_result") {
        messages.push({ type: "tool_result", content: message });
      }

      if (message.type === "result") {
        finalResult = message;
      }
    }

    const textMessages = messages
      .filter((m) => m.type === "text")
      .map((m) => m.content);

    res.json({
      sessionId: resultSessionId,
      response: textMessages[textMessages.length - 1] || null,
      messages,
      result: finalResult,
    });
  } catch (err) {
    console.error("Query error:", err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/query/stream - Stream Claude Code responses via SSE
app.post("/api/query/stream", async (req, res) => {
  const { prompt, cwd, sessionId, allowedTools, systemPrompt } = req.body;

  if (!prompt) {
    return res.status(400).json({ error: "prompt is required" });
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  try {
    const options = {
      allowedTools: allowedTools || [
        "Read",
        "Edit",
        "Write",
        "Bash",
        "Glob",
        "Grep",
      ],
      permissionMode: "bypassPermissions",
      allowDangerouslySkipPermissions: true,
      settingSources: ["project", "user"],
    };

    if (cwd || CWD) options.cwd = cwd || CWD;
    if (sessionId || SESSION_ID) options.resume = sessionId || SESSION_ID;
    if (systemPrompt) options.systemPrompt = systemPrompt;

    for await (const message of query({ prompt, options })) {
      if (message.type === "system" && message.subtype === "init") {
        res.write(
          `data: ${JSON.stringify({ type: "session", sessionId: message.session_id })}\n\n`
        );
      }

      if (message.type === "assistant" && message.message?.content) {
        for (const block of message.message.content) {
          if ("text" in block) {
            res.write(
              `data: ${JSON.stringify({ type: "text", content: block.text })}\n\n`
            );
          } else if ("name" in block) {
            res.write(
              `data: ${JSON.stringify({ type: "tool_use", tool: block.name, input: block.input })}\n\n`
            );
          }
        }
      }

      if (message.type === "result") {
        res.write(
          `data: ${JSON.stringify({ type: "result", subtype: message.subtype })}\n\n`
        );
      }
    }

    res.write("data: [DONE]\n\n");
    res.end();
  } catch (err) {
    console.error("Stream error:", err);
    res.write(
      `data: ${JSON.stringify({ type: "error", message: err.message })}\n\n`
    );
    res.end();
  }
});

// POST /api/slack/init - Initialize Slack bot with a refresh token
app.post("/api/slack/init", async (req, res) => {
  const { refreshToken } = req.body;

  if (!refreshToken) {
    return res.status(400).json({ error: "refreshToken is required" });
  }

  const clientId = process.env.SLACK_CLIENT_ID;
  const clientSecret = process.env.SLACK_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return res.status(500).json({
      error: "SLACK_CLIENT_ID and SLACK_CLIENT_SECRET must be set",
    });
  }

  try {
    const tokenManager = new TokenManager({ clientId, clientSecret });
    const { teamId } = await tokenManager.initFromRefreshToken(refreshToken);

    const slackApp = createSlackBot({ tokenManager, teamId });
    await slackApp.start();

    res.json({
      teamId,
      message: `Slack bot started for team ${teamId}`,
    });
  } catch (err) {
    console.error("Slack init error:", err);
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Claude Agent Slack server listening on port ${PORT}`);

  if (CWD) {
    console.log(`Working directory: ${CWD}`);
  }
  if (SESSION_ID) {
    console.log(`Session ID: ${SESSION_ID}`);
  }

  // Auto-start Slack bot if env vars are set
  if (process.env.SLACK_BOT_TOKEN) {
    // Direct bot token mode (no token rotation)
    const slackApp = createSlackBot({
      botToken: process.env.SLACK_BOT_TOKEN,
      cwd: CWD,
    });
    slackApp
      .start()
      .then(() => console.log("Slack bot started"))
      .catch((err) => console.error("Slack bot failed to start:", err));
  } else if (
    process.env.SLACK_BOT_REFRESH_TOKEN &&
    process.env.SLACK_CLIENT_ID &&
    process.env.SLACK_CLIENT_SECRET
  ) {
    // Token rotation mode
    const tokenManager = new TokenManager({
      clientId: process.env.SLACK_CLIENT_ID,
      clientSecret: process.env.SLACK_CLIENT_SECRET,
    });

    tokenManager
      .initFromRefreshToken(process.env.SLACK_BOT_REFRESH_TOKEN)
      .then(({ teamId }) => {
        const slackApp = createSlackBot({ tokenManager, teamId, cwd: CWD });
        return slackApp.start();
      })
      .then(() => console.log("Slack bot started"))
      .catch((err) => console.error("Slack bot failed to start:", err));
  }
});
