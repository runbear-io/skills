---
description: Set up and manage a Runbear agent's event triggers and scheduled jobs through the Runbear management MCP — event triggers (Pipedream-driven, fire when something happens in an external app like a new Gmail, a new Notion page, or a GitHub issue) and scheduled jobs (run the agent on a cron schedule or once at a set time). Use when the user wants to "trigger the agent when X happens", "run the agent every morning / weekly / on a schedule", "remind me / run this once at <time>", "notify me on Slack or email when <event>", or to list, inspect, pause, resume, or delete an agent's existing triggers. Standalone: it owns the cross-tool decision tree and preconditions; the individual MCP tools own their own mechanics. The target agent is given by app UUID, agent URL, agent name (fuzzy-matched), or "my personal agent".
argument-hint: "<appId-or-url-or-name | --personal> [list | delete] [--every <cron> | --at <time> | --on <app event>]"
allowed-tools: AskUserQuestion, Bash, mcp__*__list_agents, mcp__*__get_agent, mcp__*__get_personal_agent, mcp__*__list_supported_trigger_types, mcp__*__describe_pipedream_trigger_component, mcp__*__create_external_trigger, mcp__*__create_scheduled_job, mcp__*__list_triggers, mcp__*__get_trigger, mcp__*__update_trigger, mcp__*__delete_trigger, mcp__*__run_trigger_now, mcp__*__find_pipedream_account_id, mcp__*__generate_pipedream_connect_token, mcp__*__search_apps, mcp__*__connect_app_to_agent, mcp__*__verify_app_to_agent, mcp__*__list_slack_installations, mcp__*__list_slack_channels
---

# Manage a Runbear Agent's Triggers

Set up and manage the ways a Runbear agent runs on its own — without a person
mentioning it. There are two kinds, and picking the right one is most of the job:

- **Event trigger** (`kind: external`, Pipedream-driven) — fires when something
  happens in an external app: a new Gmail arrives, a Notion page is created, a
  GitHub issue is opened, etc.
- **Scheduled job** (`kind: scheduled`) — runs the agent on a **cron** schedule
  (`periodic`) or **once** at a specific time.

This skill owns the **decision tree, preconditions, and interactive prompts**. It
does **not** restate each tool's mechanics — the trigger MCP tools carry their own
authoritative guidance (call sequence, Pipedream prop shapes, the `reloadProps`
chain, run-now etiquette, URL formats). Follow the tool descriptions for those and
don't duplicate them here.

## Prerequisites

- The **Runbear management MCP server must be connected** in this Claude Code
  session — it exposes `list_supported_trigger_types`,
  `describe_pipedream_trigger_component`, `create_external_trigger`,
  `create_scheduled_job`, `list_triggers`, `get_trigger`, `update_trigger`,
  `delete_trigger`, and `run_trigger_now`. If those tools are unavailable, tell
  the user to connect the Runbear MCP first and stop.
- The target **agent** — an app UUID, agent URL, agent name (fuzzy-matched), or
  `--personal` / "my personal agent". Resolve it before anything else; never
  guess a UUID.

## Usage

```txt
/runbear:triggers "My Agent"                     # interview: what should fire the agent?
/runbear:triggers "My Agent" --every "0 9 * * MON"   # weekly Monday 9am scheduled job
/runbear:triggers "My Agent" --at "tomorrow 3pm"     # one-shot scheduled job
/runbear:triggers "My Agent" --on "new Gmail"        # event trigger from an app
/runbear:triggers "My Agent" list                    # list existing triggers
/runbear:triggers --personal list                    # the caller's personal agent
```

## Step 1 — Resolve the target agent

- **UUID** or **Runbear agent URL** (`.../agents/<uuid>`) → use directly.
- **`--personal`** / "my personal agent" → `get_personal_agent`.
- **Anything else** → treat as a name and resolve with `list_agents` (fuzzy):
  - **No match** → retry once with a shorter query; if still nothing, say so and
    stop.
  - **One match** → use it; confirm the name and app id.
  - **More than one** → do **not** guess. Disambiguate with `AskUserQuestion`
    (the interactive UI), one option per candidate (name, app id, a
    disambiguator), and use the one the user picks.

Capture whether this is a **team agent** or the **personal agent** — it decides the
detail-URL shape later.

## Step 2 — Pick the trigger kind (decision tree)

Read the user's intent and route. When it's ambiguous, ask with `AskUserQuestion`
(interactive UI) — options **Event trigger** (when something happens in an app) vs
**Scheduled job** (on a clock).

- "**when** a new `<app>` `<thing>` happens", "on every new email / issue / row",
  reacting to an external event ⇒ **event trigger** → Step 3.
- "**every** morning / Monday / hour", "on a schedule", a cron-like cadence ⇒
  **scheduled job (periodic)** → Step 4.
- "**once**", "at 3pm tomorrow", "remind me on `<date>`" ⇒ **scheduled job (once)**
  → Step 4.
- "**list / show / what triggers** does it have", "pause / resume / delete", "run
  it now" ⇒ **manage existing** → Step 5.

Delivery is a separate axis from kind: **what** the agent produces vs **where** the
result goes. Keep those apart (see Step 6).

## Step 3 — Create an event trigger

Follow the tools' own sequence and prop rules; this skill just orders it and adds
the preconditions:

1. `list_supported_trigger_types` (narrow with `query`, e.g. `gmail`, `github`) to
   pick a real component key. Prefer the **latest version**, and prefer **OAuth**
   over API-key variants — recommend OAuth to the user first, mention key auth only
   as a fallback.
   - If several plausible components match, choose with `AskUserQuestion`.
2. Resolve the component's schema with `describe_pipedream_trigger_component`,
   following the `reloadProps` chain until required props are satisfied. Use the
   **exact prop shapes the tool describes** (app/auth props as
   `{ authProvisionId }` objects, timer props nested) — don't invent shapes here.
3. **App account precondition** — an app/auth prop needs a connected Pipedream
   account id. Use `find_pipedream_account_id`; if none exists, use
   `generate_pipedream_connect_token` to have the user connect the account, then
   re-resolve. Do not fabricate an `apn_...` id.
4. Create with `create_external_trigger`. If the user wants notifications, pass
   `notificationConfig` **in the same call** (Step 6) — don't create then update.
5. **After creation:** an event trigger can't be run manually — do **not** offer
   to run it now. Confirm it's live and tell the user how to test it by producing a
   real event (e.g. send themselves a matching email). Describe the **outcome
   only** — never surface polling / interval / "every minute" internals.

## Step 4 — Create a scheduled job

1. **App precondition** — if the job's `prompt` needs a specific app (e.g.
   "summarize my Linear work"), that app must be connected and healthy on the agent
   first: `search_apps` → `connect_app_to_agent` → `verify_app_to_agent` until
   `{ status: 'connected' }`. Only then create the job.
2. Create with `create_scheduled_job`:
   - `periodic` → a Vixie cron expression + IANA timezone. **Minimum interval is
     hourly** — finer schedules are rejected; if the user asked for sub-hourly, say
     so and offer the closest allowed cadence.
   - `once` → a future `executeAt` (ms). Convert the user's natural-language time in
     their timezone; confirm the resolved absolute time back to them.
   - **Delivery:** to post a reply, pass `slackAppInstallationId` + `target` (or
     `teamsTarget`). For a **silent** job (tool calls fire, nothing posted) pass
     `notify: false` and omit the destination — this is also the only way for a
     Teams-only org with no Slack install.
3. **After creation:** a scheduled job **can** be run on demand. Tell the user the
   returned `url` and ask — with `AskUserQuestion` — whether to run it now. Only
   call `run_trigger_now` if they confirm; never auto-run.

## Step 5 — Manage existing triggers

- **List** — `list_triggers` for the agent; each item's `kind` (`external` /
  `scheduled`) is the discriminator the other tools take. Use `get_trigger` for one
  item's full config.
- **Pause / resume** — `update_trigger` with `status: INACTIVE` / `ACTIVE`.
- **Edit** — `update_trigger` (only the fields you pass change): `triggerPrompt` /
  `filterPrompt` / `configuredProps` / `notificationConfig` for external;
  `name` / `prompt` / `config` / destination for scheduled.
- **Delete** — confirm with the user first (`AskUserQuestion`), then
  `delete_trigger`.
- **Run now** — `run_trigger_now`, scheduled jobs only; event triggers can't be
  invoked manually.

## Step 6 — Delivery (notifications)

`triggerPrompt` / job `prompt` describe **WHAT** to produce; `notificationConfig`
(external) or `slackAppInstallationId`+`target` / `teamsTarget` (scheduled)
describe **WHERE / HOW** to deliver it. Never put a Slack/email destination in the
prompt and *also* in the delivery config — pick the delivery config.

Resolve destination ids before building the config:
- Slack — `list_slack_installations` for the installation, `list_slack_channels`
  for the channel id (or a user id for a DM). When the Slack tools aren't
  available, ask the user for the ids with `AskUserQuestion` / a direct ask rather
  than guessing.

## Guardrails (cross-cutting)

- **Never expose internals** — `intervalSeconds`, the literal `60`, "polling",
  "every minute / 60 seconds", "near real-time". Describe the user-facing outcome
  only.
- **Detail URL shape** — team agent:
  `https://app.runbear.io/agents/{agentId}/event-triggers/{id}`; personal agent:
  `https://app.runbear.io/personal/event-triggers/{id}`. No other path exists
  (`/scheduled-jobs/…`, `/triggers/…` 404).
- **Org limit** — if `create_external_trigger` returns a limit message ("You can
  create up to N external triggers."), do **not** claim it was created or surface a
  URL. Explain the blocker and offer to `list_triggers` or `delete_trigger` (after
  confirmation) to free a slot.
- **Interactive UI** — every disambiguation, type choice, destination pick, delete
  confirmation, and run-now prompt uses `AskUserQuestion`, never a plain-text
  menu.
- **Opening links** — when you show a connect/auth URL (e.g. from
  `generate_pipedream_connect_token`), open it for the user with `Bash` (background,
  non-blocking, cross-platform: `open` / `xdg-open` / `start`) and also print it as
  a fallback for headless sessions.

## Success response

```txt
✅ Trigger set up
agent:    <agentName>  (<team|personal>)
kind:     event trigger — <app event>   |   scheduled job — <cron | once @ time>
delivery: <Slack #channel / DM / email>   |   silent (no post)
url:      <detail url>
next:     <event: produce a real event to test>  |  <scheduled: run it now?>
```

## Notes

- This is standalone — it doesn't read or write the `.runbear/deploy.json` manifest.
  Triggers live on the hosted agent and are managed directly through the MCP.
- The trigger MCP tools are the source of truth for their own mechanics. If a
  tool's guidance and this skill ever disagree on prop shapes, call sequence, or
  run-now etiquette, follow the **tool**.
