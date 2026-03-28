---
description: Create and configure a Slack bot using a Slack refresh token with OAuth token rotation. Use when the user wants to set up a new Slack bot, connect to a Slack workspace, configure Slack integration, or troubleshoot Slack token issues. Also use when someone mentions "refresh token", "Slack bot", or "connect to Slack".
argument-hint: "[refresh-token]"
allowed-tools: Read, Edit, Write, Bash, Glob, Grep
---

# Setup Slack

Set up a Slack bot that connects to a workspace using OAuth token rotation (refresh tokens) and routes messages through Claude Code via the Agent SDK.

For how token rotation works, see [references/token-rotation.md](references/token-rotation.md).
For bot architecture overview, see [references/architecture.md](references/architecture.md).

## Setup Flow

### Step 1: Install dependencies

Run the install script to check and install any missing packages:

```bash
bash ${CLAUDE_SKILL_DIR}/scripts/install-deps.sh
```

### Step 2: Get the Slack configuration refresh token

If the user passed a refresh token as `$ARGUMENTS`, use it directly and skip to Step 3.

Otherwise, ask the user to:
1. Visit https://api.slack.com/apps
2. Scroll to the **bottom** of the page
3. **Wait 3-5 seconds** — the "Configuration Tokens" section appears with a delay
4. Click **"Generate Token"**
5. Copy the **Refresh Token** (starts with `xoxe-...`)

### Step 3: Store the refresh token in .env

Run the script to store the refresh token. This will comment out any previous `SLACK_REFRESH_TOKEN` value:

```bash
node ${CLAUDE_SKILL_DIR}/scripts/store-refresh-token.js <refresh-token>
```

### Step 4: Ask for bot name

Ask the user only for the **bot name** (e.g., "Claude Agent"). Do NOT ask for scopes or other configuration — the skill uses a predefined set of scopes.

### Step 5: Create the Slack app and configure everything

This single script handles all configuration via the Slack API:

```bash
node ${CLAUDE_SKILL_DIR}/scripts/create-slack-app.js "<bot-name>"
```

The script automatically:
1. Exchanges the config refresh token for an access token via `tooling.tokens.rotate`
2. Updates `SLACK_REFRESH_TOKEN` in `.env` (token rotation — the old one is invalidated)
3. Creates a new Slack app via `apps.manifest.create` with:
   - All predefined bot scopes
   - Socket Mode enabled
   - Event subscriptions (`app_mention`, `message.im`) configured
4. Stores `SLACK_APP_ID`, `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET`, `SLACK_SIGNING_SECRET` in `.env`

### Step 6: Install to Workspace

Run the install script, which opens the Slack OAuth page directly in the browser and captures the bot tokens via a local redirect:

```bash
node ${CLAUDE_SKILL_DIR}/scripts/install-app.js
```

The user authorizes in the browser. The script captures bot tokens, stores them in `.env`, and exits.

### Step 7: Get the App-Level Token

The app-level token (`xapp-...`) is needed for Socket Mode. There is no API to generate it — the user must create it in the Slack UI.

Ask the user to:
1. Go to `https://api.slack.com/apps/<APP_ID>/general`
2. Scroll to **App-Level Tokens**
3. Click **Generate Token**
4. Name: `Socket Mode`, Scope: `connections:write`
5. Copy the `xapp-...` token and paste it here

Then store it:
```bash
node ${CLAUDE_SKILL_DIR}/scripts/store-app-token.js <xapp-token>
```

### Step 8: Start the bot

Tell the user to run `/dispatch-slack:dispatch` to start the bot.

## Customization

After setup, the user can customize bot behavior with env vars:
- `CLAUDE_CWD` — Working directory for Claude Code (defaults to project root)
- `CLAUDE_SYSTEM_PROMPT` — Custom system prompt for the bot's Claude instance

## Troubleshooting

If the user hits issues, check:
1. Run `node ${CLAUDE_SKILL_DIR}/scripts/verify-token.js` to test the bot token
2. Run `node ${CLAUDE_SKILL_DIR}/scripts/check-scopes.js` to verify scopes
3. Common errors are documented in [references/token-rotation.md](references/token-rotation.md)
