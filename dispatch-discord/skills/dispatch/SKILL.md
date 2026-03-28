---
description: Start or stop the Discord bot server that connects local Claude Code to Discord. Use when the user wants to run the bot, start the server, connect to Discord, stop the bot, kill the server, or disconnect from Discord.
argument-hint: "[start|stop|restart|status] [working-directory]"
allowed-tools: Bash, Read, Grep, Glob
---

# Dispatch Discord

Start, stop, restart, or check the status of the Discord bot server, which connects local Claude Code to Discord via the Agent SDK.

The server entry point is `scripts/index.js`. The default port is `3000` (override with `--port <number>` or `PORT` env var).

## Arguments

Parse `$ARGUMENTS` for:
1. **Action**: `start`, `stop`, `restart`, `status` (default: `start`)
2. **Working directory**: An optional path passed to the server — the directory where the bot's Claude Code instance will operate.

Examples:
- `/dispatch-discord:dispatch start /Users/me/my-project`
- `/dispatch-discord:dispatch stop`
- `/dispatch-discord:dispatch` (defaults to start)

## Mode Selection

Before executing the `start` command, ask the user which mode to run in:

1. **Local** — Run directly on the host machine. Simple, uses local Claude Code auth.
2. **Docker** — Run in a container. The Claude subprocess is sandboxed. Requires Docker and `CLAUDE_CODE_OAUTH_TOKEN` or `ANTHROPIC_API_KEY` in `.env`.

If the user does not specify, default to **local**.

## Commands

### start

#### Pre-checks (both modes)

1. Check if the server is already running:
```bash
lsof -ti:${PORT:-3000} 2>/dev/null
```
If already running, inform the user and ask if they want to restart.

2. Check that `.env` in the project root (`$PROJECT_ROOT`) has the required vars:
```bash
grep -c "^DISCORD_BOT_TOKEN" "$PROJECT_ROOT/.env"
```
If missing, tell the user to run `/dispatch-discord:init` first.

#### Local mode

1. Install dependencies (if `node_modules/` is missing):
```bash
cd "$SKILL_DIR" && npm install
```

2. Copy `.env` from the project root to the skill directory so the server can load it:
```bash
cp "$PROJECT_ROOT/.env" "$SKILL_DIR/.env"
```

3. Start the server in the background:
```bash
PROJECT_DIR="/private/tmp/claude-$(id -u)/$(echo "$PROJECT_ROOT" | tr '/' '-')" && SESSION_ID="$(find "$PROJECT_DIR"/*/tasks -name "*.output" -maxdepth 1 2>/dev/null | xargs ls -t 2>/dev/null | head -1 | sed "s|$PROJECT_DIR/||;s|/tasks/.*||")" && cd "$SKILL_DIR" && npm start -- --cwd "$PROJECT_ROOT" --session-id "$SESSION_ID" $ARGUMENTS
```

Run this in the background so the conversation can continue.

Wait a few seconds, then check output to confirm "Discord bot started" appears.

#### Docker mode

1. Check Docker is available:
```bash
docker compose version
```
If not installed, tell the user to install Docker and try again, or use local mode instead.

2. **Authentication** — Check that `.env` has a credential the container can use:
```bash
grep -c "^CLAUDE_CODE_OAUTH_TOKEN\|^ANTHROPIC_API_KEY" "$PROJECT_ROOT/.env"
```
If neither is set, tell the user to run `claude setup-token` on the host machine and add `CLAUDE_CODE_OAUTH_TOKEN=sk-ant-oat01-...` to `.env`.

3. Copy `.env` into the skill directory so Docker can access it:
```bash
cp "$PROJECT_ROOT/.env" "$SKILL_DIR/.env"
```

4. Ask the user which directory to mount as the workspace. Default to `$PROJECT_ROOT`.

5. Build and start with the workspace mounted:
```bash
cd "$SKILL_DIR" && WORKSPACE_PATH="<workspace-dir>" docker compose up -d --build
```
Replace `<workspace-dir>` with the **absolute path** the user chose (default: `$PROJECT_ROOT`). The project is mounted at the same path inside the container so Claude Code session keys match the host, enabling session continuity.

6. Verify:
```bash
docker compose -f "$SKILL_DIR/docker-compose.yml" logs --tail 20
```
Confirm "Discord bot started" appears in the logs.

### stop

#### Local mode
1. Kill the server:
```bash
kill $(lsof -ti:${PORT:-3000}) 2>/dev/null
```

#### Docker mode
1. Stop the container:
```bash
cd "$SKILL_DIR" && docker compose down
```

### restart

Stop then start (preserves mode and any working directory argument).

### status

**Local:**
```bash
lsof -ti:${PORT:-3000} 2>/dev/null
```
If a PID is returned, the server is running. Otherwise it is stopped.

**Docker:**
```bash
docker compose -f "$SKILL_DIR/docker-compose.yml" ps
```

## API

**POST /api/query** — run a prompt, return full JSON response.

Request body: `prompt` (required), `cwd`, `sessionId`, `allowedTools`, `systemPrompt`.

## Gotchas

- The server binds to `0.0.0.0`, not `127.0.0.1`. It accepts connections from any interface.
- **Local mode**: The Agent SDK inherits local Claude Code authentication. No API key needed.
- **Docker mode**: Requires `CLAUDE_CODE_OAUTH_TOKEN` or `ANTHROPIC_API_KEY` in `.env`. Generate an OAuth token with `claude setup-token`. The `~/.claude` directory is also mounted (useful on Linux where credentials are file-based, but insufficient on macOS where auth is stored in Keychain).
- Sessions are tracked per Discord thread. First message creates a new session; replies resume it.
- Discord messages have a 2000 character limit. Long responses are split across multiple messages by logical sections (headings, code blocks, paragraphs).
- Responses stream progressively by editing the reply message (~1 edit per second to stay within Discord rate limits).
- Files written by Claude via the `Write` tool are automatically sent as Discord attachments after the response. Eligible extensions: `.pdf`, `.md`, `.txt`, `.csv`, `.json`, `.xml`, `.html`, `.log`, `.yaml`, `.yml`, `.js`, `.ts`, `.py`, `.sh`, `.sql`, and more. Files must be under 25MB (Discord limit). Empty or missing files are skipped.
