---
description: Start or stop the Slack bot server that connects local Claude Code to Slack. Use when the user wants to run the bot, start the server, connect to Slack, stop the bot, kill the server, or disconnect from Slack.
argument-hint: "[start|stop|restart|status] [working-directory]"
allowed-tools: Bash, Read, Grep, Glob
---

# Dispatch Slack

Start, stop, restart, or check the status of the Slack bot server, which connects local Claude Code to Slack via the Agent SDK.

The server entry point is `scripts/index.js`. The default port is `3000` (override with `--port <number>` or `PORT` env var).

## Arguments

Parse `$ARGUMENTS` for:
1. **Action**: `start`, `stop`, `restart`, `status` (default: `start`)
2. **Working directory**: An optional path passed to the server — the directory where the bot's Claude Code instance will operate.

Examples:
- `/dispatch-slack:dispatch-slack start /Users/me/my-project`
- `/dispatch-slack:dispatch-slack stop`
- `/dispatch-slack:dispatch-slack` (defaults to start)

## Commands

### start

1. Check if the server is already running:
```bash
lsof -ti:${PORT:-3000} 2>/dev/null
```
If already running, inform the user and ask if they want to restart.

2. Check that `.env` in the project root (`$PROJECT_ROOT`) has the required vars:
```bash
grep -c "^SLACK_BOT_TOKEN\|^SLACK_BOT_REFRESH_TOKEN" "$PROJECT_ROOT/.env"
grep -c "^SLACK_APP_TOKEN" "$PROJECT_ROOT/.env"
```
If missing, tell the user to run `/dispatch-slack:setup-slack` first.

3. Install dependencies (if `node_modules/` is missing):
```bash
cd "$SKILL_DIR" && npm install
```

4. Set the bot's presence to online:
```bash
node "$SKILL_DIR/scripts/set-always-online.js" true
```

5. Start the server in the background:
```bash
PROJECT_DIR="/private/tmp/claude-$(id -u)/$(echo "$PROJECT_ROOT" | tr '/' '-')" && SESSION_ID="$(find "$PROJECT_DIR"/*/tasks -name "*.output" -maxdepth 1 2>/dev/null | xargs ls -t 2>/dev/null | head -1 | sed "s|$PROJECT_DIR/||;s|/tasks/.*||")" && cd "$SKILL_DIR" && npm start -- --cwd "$PROJECT_ROOT" --session-id "$SESSION_ID" $ARGUMENTS
```

Run this in the background so the conversation can continue.

Wait a few seconds, then check output to confirm "Slack bot started" appears.

### stop

1. Set the bot's presence to offline:
```bash
node "$SKILL_DIR/scripts/set-always-online.js" false
```

2. Kill the server:
```bash
kill $(lsof -ti:${PORT:-3000}) 2>/dev/null
```

### restart

Stop then start (preserves any working directory argument).

### status

```bash
lsof -ti:${PORT:-3000} 2>/dev/null
```
If a PID is returned, the server is running. Otherwise it is stopped.

## API

**POST /api/query** — run a prompt, return full JSON response.
**POST /api/query/stream** — run a prompt, stream via SSE.
**POST /api/slack/init** — start Slack bot at runtime with a refresh token.

Request body for query endpoints: `prompt` (required), `cwd`, `sessionId`, `allowedTools`, `systemPrompt`.

## Gotchas

- The server binds to `0.0.0.0`, not `127.0.0.1`. It accepts connections from any interface.
- The Agent SDK inherits local Claude Code authentication. No `ANTHROPIC_API_KEY` needed if Claude Code is already authenticated on the machine.
- Sessions are tracked per Slack thread. First message creates a new session; replies resume it.
