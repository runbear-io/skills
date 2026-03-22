---
description: Start the Claude Agent HTTP API server that exposes Claude Code via REST endpoints
---

## Setup and start

- [ ] Step 1: Install dependencies (if `node_modules/` is missing)
- [ ] Step 2: Start the server
- [ ] Step 3: Verify the server is running

### Step 1: Install dependencies

```bash
cd skills/dispatch-http && npm install
```

### Step 2: Start the server

```bash
PROJECT_ROOT="$(pwd)" && cd skills/dispatch-http && npm start -- --cwd "$PROJECT_ROOT" $ARGUMENTS
```

Run this in the background so the conversation can continue.

Pass `-- --port <number>` to override the default port (3000), or `-- --cwd <path>` to set the working directory for Claude Code sessions.

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
- Auth is **off by default**. Set `API_KEY` env var to enable Bearer token auth.
- The Agent SDK inherits local Claude Code authentication. No `ANTHROPIC_API_KEY` needed if Claude Code is already authenticated on the machine.
- `npm run tunnel` starts both the server and a Cloudflare quick tunnel. Requires `cloudflared` installed. The URL changes on every restart.
