# Slack App Setup Guide

This skill creates and fully configures Slack apps **programmatically** using the Slack API. The only manual step is installing the app to your workspace (requires OAuth consent).

## What the Script Automates

The `create-slack-app.js` script handles everything in a single run:

| Step | API Used | What It Does |
|------|----------|-------------|
| Token exchange | `tooling.tokens.rotate` | Exchanges config refresh token for access token |
| App creation | `apps.manifest.create` | Creates app with all scopes, socket mode, and events |
| App-level token | `apps.token.create` | Generates `xapp-...` token for Socket Mode |
| Credential storage | — | Writes all values to `.env` |

## What the Manifest Configures

The app manifest pre-configures:
- **Socket Mode**: enabled
- **Event subscriptions**: `app_mention`, `message.im`
- **Bot user**: always online, using the provided bot name
- **All bot scopes**: see full list below

## The One Manual Step: Install to Workspace

After the script runs, the user must:
1. Go to `https://api.slack.com/apps/<APP_ID>/install-on-team`
2. Click **Install to Workspace**
3. Authorize the requested scopes

This step requires interactive OAuth consent and cannot be automated.

## Getting the Configuration Refresh Token

1. Go to https://api.slack.com/apps
2. Scroll to the **bottom** of the page
3. **Wait 3-5 seconds** — the "Configuration Tokens" section appears with a delay
4. Click **Generate Token**
5. Copy the **Refresh Token** (starts with `xoxe-...`)

This is a configuration-level token for managing Slack apps programmatically. It is different from bot tokens.

## Pre-configured Bot Scopes

| Scope | Purpose |
|-------|---------|
| `app_mentions:read` | Receive @mention events |
| `channels:history` | Read channel message history |
| `channels:join` | Join public channels |
| `channels:read` | View channel info |
| `chat:write` | Send messages |
| `chat:write.customize` | Send messages with custom username/icon |
| `commands` | Add slash commands |
| `emoji:read` | View custom emoji |
| `files:read` | Read files |
| `files:write` | Upload files |
| `groups:history` | Read private channel history |
| `groups:read` | View private channel info |
| `im:history` | Read DM history |
| `mpim:history` | Read group DM history |
| `mpim:read` | View group DM info |
| `reactions:read` | Read reactions |
| `reactions:write` | Add reactions |
| `users:read` | View user info |
| `users:read.email` | View user email |
| `usergroups:read` | View user groups |
| `assistant:write` | Use assistant features |
| `canvases:read` | Read canvases |
| `canvases:write` | Write canvases |
| `search:read.files` | Search files |
| `search:read.im` | Search DMs |
| `search:read.mpim` | Search group DMs |
| `search:read.private` | Search private channels |
| `search:read.public` | Search public channels |
| `search:read.users` | Search users |

## Fallback: Manual App-Level Token

If the `apps.token.create` API call fails, the user needs to manually create the app-level token:

1. Go to https://api.slack.com/apps and select the app
2. Go to **Settings** > **Socket Mode**
3. Click **Generate Token**
4. Name it "Socket Mode" and add `connections:write` scope
5. Copy the `xapp-...` token
