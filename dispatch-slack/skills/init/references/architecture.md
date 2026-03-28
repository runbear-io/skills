# Bot Architecture

Overview of how the Slack bot components fit together.

## Components

```
scripts/
├── index.js             Express server + auto-start Slack bot
├── token-manager.js     OAuth token rotation (refresh/store/retrieve)
├── slack-bot.js         Slack Bolt app (events → Claude Code → reply)
├── set-always-online.js Toggle bot online/offline via manifest API
└── .slack-tokens.json   Persisted token storage (gitignored)
```

## Message Flow

```
Slack @mention or DM
  → Bolt event handler (slack-bot.js)
  → Post "Working on it..." indicator
  → query() from Agent SDK (claude-agent-sdk)
    → Claude Code subprocess with bypassPermissions
    → Tools: Read, Edit, Write, Bash, Glob, Grep
  → Collect text responses
  → Delete thinking indicator
  → Post response to thread (split if >3900 chars)
```

## Session Tracking

- Sessions are tracked per Slack thread: `channel:thread_ts → sessionId`
- First message in a thread creates a new Claude Code session
- Replies in the same thread resume that session (multi-turn conversation)
- Sessions are stored in memory (lost on restart)

## Two Ways to Start

1. **Auto-start**: Set `SLACK_REFRESH_TOKEN`, `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET` env vars. Bot starts on server boot.
2. **API init**: POST to `/api/slack/init` with `{ "refreshToken": "xoxe-1-..." }` to start at runtime.

## Customization via Environment

| Env Var | Effect |
|---------|--------|
| `CLAUDE_CWD` | Working directory for Claude Code |
| `CLAUDE_SYSTEM_PROMPT` | Custom system prompt for Claude |
| `PORT` | Server port (default: 3032) |
