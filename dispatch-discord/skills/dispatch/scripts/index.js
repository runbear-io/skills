const path = require("path");
require("dotenv").config();
const express = require("express");
const { query } = require("@anthropic-ai/claude-agent-sdk");
const { createDiscordBot } = require("./discord-bot");

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
const PORT = args.port || process.env.PORT || 3031;
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

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Claude Agent Discord server listening on port ${PORT}`);

  if (CWD) {
    console.log(`Working directory: ${CWD}`);
  }
  if (SESSION_ID) {
    console.log(`Session ID: ${SESSION_ID}`);
  }

  // Auto-start Discord bot if token is set
  if (process.env.DISCORD_BOT_TOKEN) {
    const client = createDiscordBot({ cwd: CWD });
    client
      .login(process.env.DISCORD_BOT_TOKEN)
      .then(() => console.log("Discord bot started"))
      .catch((err) => console.error("Discord bot failed to start:", err));
  }
});
