---
description: Create and configure a Discord bot for Claude Code. Use when the user wants to set up a new Discord bot, connect to a Discord server, configure Discord integration, or troubleshoot Discord token issues.
argument-hint: "[bot-token]"
allowed-tools: Read, Edit, Write, Bash, Glob, Grep
---

# Setup Discord

Set up a Discord bot that connects to a server and routes messages through Claude Code via the Agent SDK.

## Setup Flow

### Step 1: Install dependencies

```bash
cd "$SKILL_DIR/../dispatch-discord" && npm install
```

### Step 2: Create a Discord Application

If the user passed a bot token as `$ARGUMENTS`, skip to Step 5.

Otherwise, guide the user through the Discord Developer Portal:

1. Go to https://discord.com/developers/applications
2. Click **"New Application"** and give it a name (e.g., "Claude Agent")
3. Copy the **Application ID** from the General Information page

Store it:
```bash
node ${CLAUDE_SKILL_DIR}/scripts/store-env.js DISCORD_APPLICATION_ID <application-id>
```

### Step 3: Get the Bot Token

1. Go to the **Bot** tab (the bot is auto-created with the application)
2. Click **"Reset Token"** and copy the token (shown only once)

### Step 4: Enable Privileged Intents

On the same **Bot** tab, scroll to **Privileged Gateway Intents** and enable:
- **Message Content Intent** (required to read message text)

### Step 5: Store the Bot Token

```bash
node ${CLAUDE_SKILL_DIR}/scripts/store-env.js DISCORD_BOT_TOKEN <bot-token>
```

### Step 6: Invite the Bot to a Server

Generate and open the invite URL:

```bash
node ${CLAUDE_SKILL_DIR}/scripts/generate-invite-url.js
```

This outputs a URL. Ask the user to open it in their browser, select a server, and authorize.

### Step 7: Start the bot

Tell the user to run `/dispatch-discord:dispatch` to start the bot.

## Customization

After setup, the user can customize bot behavior with env vars:
- `CLAUDE_CWD` — Working directory for Claude Code (defaults to project root)
- `CLAUDE_SYSTEM_PROMPT` — Custom system prompt for the bot's Claude instance

## Troubleshooting

Common issues:
- **Bot doesn't respond to messages** — Make sure **Message Content Intent** is enabled in the Bot tab
- **Bot doesn't receive DMs** — This is expected by default; users must share a server with the bot
- **"Used disallowed intents" error** — Enable the required intents in the Developer Portal
