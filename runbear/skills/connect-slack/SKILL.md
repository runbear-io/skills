---
description: Connect a Runbear Claude Agent SDK agent to Slack through the Runbear management MCP (`deploy_to_slack`). Defaults to a workspace-specific custom Slack bot (`mode: custom`) — the agent gets its own bot identity instead of the shared @Runbear bot — and can join public channels afterward. Use when the user wants to connect, deploy, install, or publish a Runbear agent to Slack as its own bot, optionally joining channels. The target agent is given by app UUID, agent URL, or agent name (fuzzy-matched).
argument-hint: "<appId-or-url-or-name> [--mode custom|default] [--bot-name <name>] [--channel <name> ...]"
allowed-tools: mcp__*__list_agents, mcp__*__get_agent, mcp__*__deploy_to_slack, mcp__*__get_slack_install_link, mcp__*__list_slack_installations, mcp__*__list_slack_channels, mcp__*__join_slack_channels
---

# Connect a Runbear Agent to Slack

Connect a hosted Runbear agent to Slack so people can mention it and get replies. By
default this creates a **workspace-specific custom Slack bot** (`mode: custom`) — the
agent shows up under its own name and icon rather than the shared **@Runbear** bot. Pass
`--mode default` to use the shared Runbear Slack app instead.

**Custom mode is a two-step flow:** the custom Slack app can't be created entirely over
MCP. `deploy_to_slack` returns a **setup link** in the Runbear web app where the user
finishes creating the app (OAuth + app config). Once that's done, joining channels is
back to being MCP-driven.

## Prerequisites

- The **Runbear management MCP server must be connected** in this Claude Code session —
  it exposes `deploy_to_slack`, `list_slack_installations`, `list_slack_channels`, and
  `join_slack_channels`. If those tools are unavailable, tell the user to connect the
  Runbear MCP first and stop.
- The target **Runbear Agent SDK app UUID, agent URL, or agent name** (the first
  positional argument). A name is fuzzy-matched via `list_agents`.

## Usage

```txt
/runbear:connect-slack "My Agent"
/runbear:connect-slack <appId>
/runbear:connect-slack <appId> --bot-name "My Bot"
/runbear:connect-slack <appId> --channel project-team --channel announcements
/runbear:connect-slack <appId> --mode default
```

## Required inputs

- The target agent — an app UUID, agent URL, or agent name (fuzzy-matched, with
  interactive selection when more than one agent matches).
- Optional `--mode` — `custom` (default) for a workspace-specific bot, or `default` for
  the shared @Runbear bot.
- Optional `--bot-name "<name>"` — the custom bot's display name (custom mode only). If
  omitted, defaults to the agent's name.
- Optional `--channel <name>` (repeatable) — public channels to add the bot to after the
  connection is set up.

If the target agent is missing, ask for it only. Do not guess a UUID.

## Bot name rules (custom mode)

Slack rejects non-Latin characters in the bot name. The `botName` must be **English
letters, numbers, spaces, apostrophes, periods, or hyphens, max 35 characters**. If the
chosen name (or the agent's name, when defaulting) is not Slack-safe — e.g. it contains
Korean or other non-Latin text, or is too long — ask the user for a Slack-safe English
name before continuing. Do not silently transliterate.

## Steps

1. Parse arguments into `target` (first positional — UUID, agent URL, or name), `mode`
   (`--mode`, default `custom`), `botName` (`--bot-name`), and `channels` (each
   `--channel`, may repeat).
2. **Resolve the target into an `agentId`.**
   - A **UUID** or **Runbear agent URL** (`.../agents/<uuid>`) → use directly (extract the
     UUID from a URL).
   - **Anything else** → treat as an **agent name** and resolve with `list_agents`, passing
     the name as `query` (case-insensitive / fuzzy):
     - **No matches** → retry once with a shorter/normalized query; if still nothing, tell
       the user no agent matched and stop. Do not guess a UUID.
     - **One match** → use its `id`; confirm the name and app ID.
     - **More than one match** → do **not** guess. Present an interactive selection listing
       each candidate's **name**, **app ID**, and a disambiguator (created date,
       `createdByMe`), and use the one the user picks.
   - Also capture the resolved agent's **name** (from the `list_agents` match, or via
     `get_agent` when the target was a UUID/URL) so it can default the bot name.
3. **Determine the bot name (custom mode only).** Use `--bot-name` if given, otherwise the
   agent's name. Validate it against the **Bot name rules** above; if it isn't Slack-safe,
   ask the user for an English name and use that. (Default mode ignores the bot name.)
4. **Connect.** Call `deploy_to_slack`:
   - **custom** (default):

     ```json
     { "agentId": "<agentId>", "mode": "custom", "botName": "<botName>" }
     ```

     It returns a **setup link** (a Runbear web-app URL). Show it to the user and tell them
     to open it and finish creating the custom Slack app (authorize + install into their
     workspace). This step cannot be completed from here. Stop and wait for them to
     confirm it's done before joining any channels — the custom bot's installation doesn't
     exist until they finish.
   - **default**:

     ```json
     { "agentId": "<agentId>", "mode": "default" }
     ```

     On `status: "connected"` the agent is on the shared Runbear app — report the workspace
     name and continue to channel-joining if requested. If it instead returns an install
     link (the org hasn't installed the shared app yet), show the link and stop.
5. **Join channels** (only if `channels` was given, and — for custom mode — only after the
   user confirms the setup link is complete):
   - Call `list_slack_installations` for the agent and pick the right installation
     (`isCustomBot: true` for a custom bot; for default mode use the connected shared
     installation). If several match, ask which workspace.
   - Resolve each requested channel name to a `channelId` with `list_slack_channels`
     (paginate with `nextCursor` if needed). If a name isn't found among public channels,
     say so and skip it — it may be misspelled or private.
   - Call `join_slack_channels` with the installation id and the resolved `channelIds`.
     Report the per-channel result: only **public** channels can be joined
     programmatically; private channels return `channel_not_found` and need a manual
     `/invite @<bot>` from inside Slack.
6. Show the result (see below).

## Success response (custom)

```txt
🔗 Custom Slack app — finish setup
agent:   <agentName>
bot:     <botName>
open:    <setup link>
next:    complete the setup in the Runbear web app, then re-run with --channel <name>
         (or say the channels) to add the bot, or just @mention it in a channel.
```

## Success response (default / after channels joined)

```txt
✅ Connected to Slack
agent:     <agentName>
workspace: <slackTeamName>
mode:      <custom|default>
channels:  <joined channels>   (skipped: <not-found or private>)
next:      mention the agent in Slack to start chatting
```

## Notes

- This is the **reachability** step after `runbear:deploy`. `deploy` uploads the
  project and configures the agent's MCPs and skills; `connect-slack` is how your
  colleagues actually reach it. A successful first deploy points here.
- The shared Runbear Slack app auto-joins a channel the first time the agent is mentioned
  or a notification fires there, so an explicit channel join is often optional.
- Never ask the user to paste Slack tokens, app credentials, or MCP URLs into the chat —
  the custom Slack app is authorized through the Runbear web app, where secrets are stored
  in the vault.
