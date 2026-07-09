# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Runbear Skills is a Claude Code plugin collection that bridges Claude Agent with external interfaces (HTTP, Slack, Discord). Each plugin exposes Claude Code as a service through platform-specific servers using the `@anthropic-ai/claude-agent-sdk`.

## Architecture

Four plugins, each self-contained with independent `package.json` and `node_modules`:

- **dispatch-http** — Express REST API server (port 3000). Skills: `dispatch` (server), `expose` (Cloudflare tunnel)
- **dispatch-slack** — Slack bot via Socket Mode with streaming (port 3032). Skills: `dispatch` (bot server), `init` (OAuth setup + token rotation)
- **dispatch-discord** — Discord bot with progressive message editing (port 3031). Skills: `dispatch` (bot server), `init` (bot setup)
- **shipyard** — Build tooling. Skills: `bundle` (package skills for distribution, output to `.shipyard/build/`)

Plugin manifest: `.claude-plugin/marketplace.json`

## Common Commands

```bash
# Install dependencies for a plugin
cd dispatch-slack/skills/dispatch && npm install

# Run a skill server
npm start -- --port 3032 --cwd /path/to/project

# Docker mode (Slack/Discord)
docker compose up -d
docker compose logs --tail 20
```

CLI flags: `--port <number>`, `--cwd <path>`, `--session-id <id>` (resume prior session)

## Key Patterns

**Agent SDK usage** — All dispatch plugins follow the same pattern: create options with `permissionMode: "bypassPermissions"`, then iterate `for await (const message of query({ prompt, options }))` processing message types (`system`, `assistant`, `tool_result`, `result`).

**Streaming** — HTTP uses SSE (`/api/query/stream`). Slack throttles message updates at 300ms intervals. Discord edits messages progressively (~1/sec) with 2000-char chunking.

**Session management** — Thread-based session tracking via `threadSessions` Map keyed by `channel:thread_ts` (Slack) or channel ID (Discord). Sessions resume across messages in the same thread.

**Token rotation (Slack)** — OAuth refresh tokens stored in `.slack-tokens.json` with 24hr expiry. Auto-refreshes if token expires within 5 minutes. Fallback to direct bot token mode.

**Platform-specific formatting** — Slack converts `**bold**` to `*bold*` (mrkdwn). Discord splits at 2000 chars.

## Skill Structure

Each skill directory contains:
- `SKILL.md` — Frontmatter metadata (description, argument-hint, allowed-tools) + execution instructions
- `scripts/index.js` — Entry point
- `package.json` — Dependencies with `"start": "node scripts/index.js"`

## Runtime

- Node.js 22, CommonJS modules, pure JavaScript (no TypeScript, no build step, no bundler)
- No test framework — manual testing via health endpoints and platform interactions
- Environment config via `.env` files and CLI flags
