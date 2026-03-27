---
description: Start the Claude Agent HTTP API server that exposes Claude Code via REST endpoints
---

## Setup and start

- [ ] Step 1: Install dependencies (if `node_modules/` is missing)
- [ ] Step 2: Start the server
- [ ] Step 3: Verify the server is running

### Step 1: Install dependencies

```bash
cd "$SKILL_DIR" && npm install
```

### Step 2: Start the server

```bash
PROJECT_DIR="/private/tmp/claude-$(id -u)/$(echo "$PROJECT_ROOT" | tr '/' '-')" && SESSION_ID="$(find "$PROJECT_DIR"/*/tasks -name "*.output" -maxdepth 1 2>/dev/null | xargs ls -t 2>/dev/null | head -1 | sed "s|$PROJECT_DIR/||;s|/tasks/.*||")" && cd "$SKILL_DIR" && npm start -- --cwd "$PROJECT_ROOT" --session-id "$SESSION_ID" $ARGUMENTS
```

Where `SKILL_DIR` is the base directory shown above and `PROJECT_ROOT` is the Claude Code session's working directory.

Run this in the background so the conversation can continue.

Pass `-- --port <number>` to override the default port (3000), `-- --cwd <path>` to set the working directory, or `-- --session-id <id>` to set the default Claude session ID.

### Step 3: Verify

```bash
curl -s http://localhost:3000/health
```

Expect `{"ok":true}`.

## API

**POST /api/query** — run a prompt, return full JSON response.
**POST /api/query/stream** — run a prompt, stream via SSE.

Request body: `prompt` (required), `cwd`, `sessionId`, `allowedTools`, `systemPrompt`.

## Gotchas

- The server binds to `0.0.0.0`, not `127.0.0.1`. It accepts connections from any interface.
- Auth is **off by default**. Set `DISPATCH_HTTP_API_KEY` env var to enable Bearer token auth.
- The Agent SDK inherits local Claude Code authentication. No `ANTHROPIC_API_KEY` needed if Claude Code is already authenticated on the machine.
