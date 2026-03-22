const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../.env") });
const express = require("express");
const { query } = require("@anthropic-ai/claude-agent-sdk");

const app = express();
app.use(express.json());

// Request/response logging
app.use((req, res, next) => {
  const start = Date.now();

  // Log request
  console.log(`→ ${req.method} ${req.path}`, JSON.stringify(req.body || {}));

  // Capture response body
  const originalJson = res.json.bind(res);
  res.json = (body) => {
    const duration = Date.now() - start;
    res._jsonLogged = true;
    console.log(`← ${req.method} ${req.path} ${res.statusCode} ${duration}ms`, JSON.stringify(body));
    return originalJson(body);
  };

  // Log SSE/non-JSON responses on finish
  res.on("finish", () => {
    if (!res._jsonLogged) {
      const duration = Date.now() - start;
      console.log(`← ${req.method} ${req.path} ${res.statusCode} ${duration}ms`);
    }
  });

  next();
});

// Parse CLI flags
function parseArgs(args) {
  const parsed = {};
  for (let i = 0; i < args.length; i++) {
    const key = args[i].replace(/^--/, "");
    if (key === "port" && args[i + 1]) parsed.port = parseInt(args[++i], 10);
    else if (key === "cwd" && args[i + 1]) parsed.cwd = args[++i];
  }
  return parsed;
}

const args = parseArgs(process.argv.slice(2));
const PORT = args.port || process.env.PORT || 3000;
const CWD = args.cwd || process.env.CLAUDE_CWD || null;
const API_KEY = process.env.API_KEY;

// API key auth middleware
function authenticate(req, res, next) {
  if (!API_KEY) return next(); // skip if no key configured

  const header = req.headers.authorization;
  if (!header || header !== `Bearer ${API_KEY}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
}

app.use("/api", authenticate);

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
        "Agent",
        "Skill",
      ],
      permissionMode: "bypassPermissions",
      allowDangerouslySkipPermissions: true,
      settingSources: ["project", "user"],
    };

    if (cwd || CWD) options.cwd = cwd || CWD;
    if (sessionId) options.resume = sessionId;
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

    // Extract the final text response
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
        "Agent",
        "Skill",
      ],
      permissionMode: "bypassPermissions",
      allowDangerouslySkipPermissions: true,
      settingSources: ["project", "user"],
    };

    if (cwd || CWD) options.cwd = cwd || CWD;
    if (sessionId) options.resume = sessionId;
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

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Claude Agent API listening on port ${PORT}`);
  if (CWD) {
    console.log(`Working directory: ${CWD}`);
  }
});
