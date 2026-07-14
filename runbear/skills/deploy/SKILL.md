---
description: Deploy a local Claude Code project to a Runbear Claude Agent SDK agent AND configure the MCPs and skills it needs, so colleagues can use your agent without you doing it on their behalf. Files are uploaded through the Runbear signed-URL flow (`create_project_upload` + `finalize_project_upload`); MCPs are attached with a per-integration choice of shared vs per-user auth; skills are curated from your project and user scope; and the whole configuration is saved to a committed `.runbear/deploy.json` manifest for one-command redeploys. After deploying, if the agent has no Slack channel yet, it offers to connect Slack (via `runbear:connect-slack`) so colleagues can reach it. Use when the user wants to deploy, publish, push, sync, share, or redeploy a local project (its files, CLAUDE.md, skills, MCPs, and code) to a hosted Runbear Agent SDK agent identified by an app UUID, agent URL, or agent name (fuzzy-matched) — or, with `--new <agentName>`, to create a brand-new Claude Agent SDK agent and deploy to it in one step.
argument-hint: "<appId-or-url-or-name> | --new <agentName> [--cwd <project-path>] [--overwrite] [--add-mcp <name>] [--remove-mcp <name>] [--add-skill <path>] [--remove-skill <path>]"
allowed-tools: Bash, Read, Write, AskUserQuestion, Skill, mcp__*__list_agents, mcp__*__get_agent, mcp__*__create_agent, mcp__*__create_project_upload, mcp__*__finalize_project_upload, mcp__*__search_apps, mcp__*__attach_app, mcp__*__attach_custom_mcp, mcp__*__list_agent_tools, mcp__*__detach_tool, mcp__*__generate_integration_connect_link, mcp__*__list_slack_installations
---

# Deploy Local Project to Runbear

Deploy a local Claude Code project to a Runbear Claude Agent SDK agent **and**
configure the MCP integrations and skills it needs, so the hosted agent behaves
like your local one and your colleagues can use it directly. The goal is: *let
your colleagues use your Claude agent without you doing it on their behalf.*

A deploy does three things:

1. **Files** — packs your project into a zip and uploads it via a short-lived
   signed URL, so file bytes never pass through the model's context (deploying a
   large project costs a near-constant number of tokens). The hosted agent runs
   against the same `CLAUDE.md`, skills, subagents, docs, and code.
2. **MCPs** — you select which of your locally-configured MCP servers the hosted
   agent should have, and for each you choose **shared** (everyone uses one org
   credential) or **per-user** (each colleague authenticates as themselves).
3. **Skills** — you curate which skills the agent ships with, from both your
   project (`.claude/skills/`) and your user scope (`~/.claude/skills/`).

Every choice is written to a committed **`.runbear/deploy.json`** manifest, so a
later `deploy` reproduces the exact same agent, or adjusts it with `--add-*` /
`--remove-*` flags.

After a successful deploy, if the agent isn't connected to Slack yet, the skill
offers to run `runbear:connect-slack` so your team can actually reach it.

Unlike `skill-uploader:upload` (a single `SKILL.md`), this deploys the **whole
project** and configures the agent end to end.

## Prerequisites

- The **Runbear management MCP server must be connected** in this Claude Code
  session — it exposes `create_project_upload`, `finalize_project_upload`,
  `search_apps`, `attach_app`, `attach_custom_mcp`, `list_agent_tools`,
  `detach_tool`, `list_slack_installations`, `list_agents`, and `get_agent`. If
  those tools are unavailable, tell the user to connect the Runbear MCP first and
  stop.
- The target **Runbear Agent SDK app UUID, agent URL, or agent name** (first
  positional argument), or `--new "<agentName>"`. A name is fuzzy-matched via
  `list_agents`. The target agent must be of type **Claude Agent SDK** (the
  backend rejects others with `agent_must_be_claude_agent_sdk`).
- The **`claude` CLI** on PATH (used to enumerate local MCPs via `claude mcp
  list` / `claude mcp get`).
- Local tools: `git`, `zip`, and `curl` on PATH.

## Usage

Deploy to an existing agent (first deploy is guided; MCP/skill selection runs):

```txt
/runbear:deploy <appId>
/runbear:deploy https://app.runbear.io/agents/<appId>
/runbear:deploy "My Agent"
/runbear:deploy "My Agent" --cwd ./my-project --overwrite
```

Create a new Claude Agent SDK agent and deploy to it in one step:

```txt
/runbear:deploy --new "My Agent"
/runbear:deploy --new "My Agent" --cwd ./my-project
```

Redeploy with the saved settings (silent — no re-prompting), optionally editing
the MCP/skill set:

```txt
/runbear:deploy "My Agent"
/runbear:deploy "My Agent" --add-mcp linear --remove-skill .claude/skills/old
/runbear:deploy "My Agent" --add-skill .claude/skills/triage --remove-mcp stripe
```

## Required inputs

Exactly one target is required:

- **Existing agent** — a Runbear Agent SDK app UUID, agent URL, or agent name as
  the **first positional argument** (fuzzy-matched, with interactive selection
  when more than one agent matches), or
- **New agent** — `--new <agentName>`, which creates a fresh Claude Agent SDK
  agent and deploys to it.

Plus:

- Optional `--cwd <path>` for the local project folder (defaults to `.`).
- Optional `--overwrite` to replace files that already exist in the agent
  workspace (irrelevant with `--new`, whose workspace starts empty).
- Optional edit flags (redeploy only): `--add-mcp <name>`, `--remove-mcp
  <name>`, `--add-skill <path>`, `--remove-skill <path>` (each repeatable).

If neither a target nor `--new` is given, ask which agent to deploy to. Do not
guess a UUID, and do not create an agent unless the user passed `--new`.

## The deploy manifest (`.runbear/deploy.json`)

The manifest records what this project deploys and how. It is **committed to the
repo** (shareable, versioned) and **excluded from the upload** (the pack script
filters `.runbear/` automatically — it never lands in the agent workspace).

```jsonc
{
  "version": 1,
  "agentId": "943276d9-a4a6-4d49-8df4-6e0fb05b2ab7",
  "agentName": "Support Bot",
  "mcps": [
    // catalog match → attach_app
    { "localName": "notion", "attach": "app", "runbearKey": "managed:notion", "userType": "user" },
    // remote custom, OAuth → attach_custom_mcp (no secret)
    { "localName": "linear", "attach": "custom", "url": "https://mcp.linear.app/mcp",
      "transportType": "streamableHttp", "auth": { "type": "oauth" }, "userType": "user" },
    // remote custom, static secret → vaulted server-side; NO secret stored here
    { "localName": "heyreach", "attach": "custom", "url": "<vaulted>",
      "transportType": "streamableHttp", "auth": { "type": "static" }, "userType": "app" }
  ],
  "skills": [".claude/skills/triage", ".claude/skills/summarize"],
  "lastDeployedAt": "2026-07-09T00:00:00Z"
}
```

Manifest rules (NON-NEGOTIABLE):

- **Never write a secret into the manifest.** For a secret-bearing custom MCP,
  store the literal string `"<vaulted>"` in place of the URL/credential — the
  real secret lives only in the Runbear vault (set via `attach_custom_mcp`).
- `userType` is `"app"` (shared) or `"user"` (per-user).
- `attach` is `"app"` (catalog → `attach_app`) or `"custom"` (→
  `attach_custom_mcp`).
- A missing manifest ⇒ **first deploy** (guided). A manifest that fails to parse
  ⇒ report it to the user and stop; do not silently overwrite it.

## Safety rules

- The packing script filters files by path and pre-scans text files for secrets;
  the backend re-validates authoritatively after unzip. Both layers block:
  - Secrets / env: `.env`, `.env.*`, and any file containing API keys, tokens,
    private keys, bearer tokens, or `postgres://user:pass@` URLs.
  - Credential/agent config: `.mcp.json`, `.claude/settings.json`,
    `.claude/settings.local.json`, `.claude.json`.
  - `.git/`, `.runbear/`, `node_modules/`, and build/dep output (`dist/`,
    `build/`, `.next/`, `.turbo/`, `.omc/`, `coverage/`, `.venv/`, `vendor/`,
    `__pycache__/`).
- The script respects `.gitignore` (via `git ls-files`).
- The backend caps a deploy at **500 files** / **25 MiB decompressed** / **50
  MiB zip**. If the project is larger, deploy a meaningful subset and tell the
  user what you left out. Never silently truncate.
- Do not read project file contents into your own context just to deploy them —
  let the script handle the bytes. That is the whole point of the signed-URL
  flow.
- **MCP secrets:** only read a raw MCP secret (a static header token, or a
  secret embedded in a URL) into your context after the user confirms the
  per-MCP secret prompt (see Step 6). Confirming means that secret transits the
  chat transcript and provider logs. Never echo a resolved MCP secret back to
  the user or into the report.
- Never ask the user for GCS bucket names, paths, or credentials.

## Steps

`<skill-dir>` below is this skill's base directory (the folder containing this
`SKILL.md`).

### Step 1 — Parse arguments

Parse into `target` (first positional — UUID, agent URL, or agent name),
`newAgentName` (`--new`), `projectPath` (`--cwd`, default `.`), `overwrite`
(default false), and the edit flags `addMcps` / `removeMcps` / `addSkills` /
`removeSkills` (each a list). `target` and `--new` are mutually exclusive; if
both are present, ask which they meant and stop.

### Step 2 — Resolve the target into an `agentId`

- **`--new <agentName>`** — create the agent first with `create_agent`:

  ```json
  { "name": "<agentName>", "type": "claude-agent-sdk" }
  ```

  Use the returned `id` as `agentId`; show the returned `url`. If `create_agent`
  is unavailable (Runbear MCP connected in team mode, where it's hidden), tell
  the user to connect the Runbear MCP at user scope and stop. Do not fall back to
  an existing agent.
- **`target` is a UUID or Runbear agent URL** (`.../agents/<uuid>`) — use it
  directly (extract the UUID from a URL). Capture the agent name via `get_agent`.
- **`target` is anything else** — treat it as an **agent name** and resolve with
  `list_agents`, passing the name as `query` (case-insensitive fuzzy filter):
  - **No matches** — retry once with a shorter/normalized query. If still
    nothing, tell the user no agent matched, suggest `--new "<name>"`, and stop.
  - **Exactly one match** — use its `id`; confirm by showing name + app ID.
  - **More than one match** — do NOT guess. Present an interactive selection
    listing each candidate's **name**, **app ID**, and a disambiguator (created
    date, `createdByMe`). If `list_agents` reports a non-null `nextCursor`, say
    so and offer to narrow the name rather than truncating.

### Step 3 — Load manifest, decide first-deploy vs redeploy

Read `<projectPath>/.runbear/deploy.json`.

- **Missing** ⇒ first deploy: run the guided selection (Steps 4–7).
- **Present & parses** ⇒ redeploy: skip the interactive selection and reuse the
  saved `mcps` / `skills`, then apply any edit flags (see **Redeploy** below).
  If the saved `agentId` differs from the resolved `agentId`, tell the user and
  ask which one wins before continuing.
- **Present but unparseable** ⇒ report it and stop.

### Step 4 — Select MCPs (first deploy)

1. **Enumerate** local MCPs: run `claude mcp list`, then `claude mcp get <name>`
   for each to read its scope, transport (`http`/`sse`/`stdio`), URL, and auth.
2. **Filter to the user's own MCPs:** keep only **project**, **user**, and
   **local** scope servers. Exclude `plugin:*` servers and the claude.ai
   built-in remotes (e.g. `claude.ai Slack`, `Gmail`, `Google Drive`) — they're
   host-specific and won't map to Runbear.
3. **Classify** each remaining MCP (used in Step 6):
   - `stdio` transport with no catalog equivalent → **un-deployable** (the hosted
     agent can't run local commands).
   - `http`/`sse` transport → **remote** (catalog match or custom attach).
4. **AI suggestion:** read `CLAUDE.md` and the project structure, and pre-select
   a recommended subset of the eligible MCPs, each with a one-line rationale
   (e.g. "Notion — your CLAUDE.md references a Notion knowledge base").
5. **Confirm** with `AskUserQuestion` (multi-select): show the eligible MCPs with
   the recommended ones pre-checked; let the user add/remove. Selecting zero is
   allowed (deploy proceeds with files/skills only).

### Step 5 — Choose shared vs per-user auth

For the selected MCPs:

- MCPs whose auth is a **single shared credential** (static header token,
  secret-in-URL, or `none`) are inherently **shared** (`userType: "app"`). State
  this; don't offer a per-user option for them.
- For the remaining **OAuth-capable** MCPs, ask (via `AskUserQuestion`,
  multi-select) which should be **shared**. Everything not chosen defaults to
  **per-user** (`userType: "user"`).

  **Say this before they pick "shared" for any OAuth MCP:** a deploy **cannot**
  carry your local OAuth login. Claude Code's OAuth tokens live in your OS
  keychain, are never returned by `claude mcp get`, and are bound to Claude
  Code's own OAuth client — so the server is attached with *no credential*. A
  **shared** OAuth MCP must have its org connection **authorized once in the
  Runbear web UI** (`/agents/<agentId>/integrations`) before its tools work for
  anyone. A **per-user** OAuth MCP instead prompts each colleague to authorize on
  first use. Either way the attach step only *registers* the server — an OAuth
  MCP has no callable tools until that authorization happens. (Static-secret and
  secret-in-URL MCPs are different: their credential *is* vaulted during deploy,
  see Step 6.)
- If the target is a **personal agent**, note that the backend coerces
  everything to `app` (per-user is meaningless for a single-owner agent) and skip
  the shared/per-user question. The shared-OAuth caveat above still applies — a
  personal agent's OAuth MCPs must be authorized once in the web UI.

### Step 6 — Attach the selected MCPs

For each selected MCP, resolve an attach path **in this order**:

1. **Catalog match** — call `search_apps` with the MCP's name (and, if helpful,
   its host). If a confident match is found (prefer OAuth variants and the latest
   version), attach it with `attach_app`:

   ```json
   { "agentId": "<agentId>", "key": "<key from search_apps>", "userType": "<app|user>" }
   ```

2. **Remote, no catalog match** → `attach_custom_mcp` using the local URL and
   transport:
   - **OAuth or no-auth** — attach directly, no secret prompt:

     ```json
     { "agentId": "<agentId>", "app": "<localName>", "url": "<url>",
       "transportType": "<streamableHttp|sse>", "userType": "<app|user>",
       "auth": { "type": "oauth" } }
     ```

     This registers the server but stores **no credential** — see the
     shared-OAuth flag at the end of this step.

   - **Secret-bearing** (a static header token, or a secret in the URL) — first
     **prompt the user per-MCP** before reading the secret from `claude mcp get`.
     If they decline, skip this MCP and list it in the report with a pointer to
     `/agents/<agentId>/integrations`. If they confirm, vault the secret:

     ```json
     { "agentId": "<agentId>", "app": "<localName>", "url": "<url>",
       "transportType": "streamableHttp", "userType": "app",
       "auth": { "type": "static", "headerKey": "Authorization" },
       "httpHeaders": { "Authorization": { "type": "secret", "value": "<token>" } } }
     ```

     (For a secret embedded directly in the URL, pass the full URL and
     `auth: { "type": "none" }`; the secret rides in the URL query. It is still a
     secret — gate it behind the same per-MCP prompt.)

3. **stdio with no catalog match** → do not attach; add it to the report's
   un-deployable list with a link to `/agents/<agentId>/integrations`.

**Flag shared-OAuth attaches for the report.** For any **OAuth-capable** MCP
(Step 5) attached with `userType: "app"` — whether via `attach_app` (6.1) or
`attach_custom_mcp` (6.2) — the attach registers the server but leaves it with
**no usable credential**: the org OAuth grant must be authorized once before the
tools work. Record every such MCP (keep its integration `id` from the
`attach_custom_mcp` / `attach_app` response) as **pending authorization** and
list it in the report's `needs-oauth:` section (Step 10 / Success response).
Static-secret and secret-in-URL shared MCPs are already vaulted during attach and
do **not** belong in this list.

**Do NOT auto-generate connect links.** The report only *lists* the pending
MCPs — it does not mint or print any `authUrl`. A connect link is an
agent-scoped, one-shot credential-granting URL; surfacing one unprompted (or in
a shared channel) is a leak vector (RB-6505 / RB-6517). Instead, tell the user
they can ask for a link per MCP, and mint it **on request** (see
**Connecting a shared-OAuth MCP** below).

Record each attached MCP (`localName`, `attach`, `runbearKey`/`url`, `auth.type`,
`userType`) for the manifest. Store `"<vaulted>"` instead of any secret-bearing
url/credential.

### Step 7 — Select and stage skills

1. **Enumerate** project skills (`<projectPath>/.claude/skills/*/SKILL.md`) and
   user-scope skills (`~/.claude/skills/*/SKILL.md`).
2. **AI suggestion:** using each skill's front-matter `description` plus
   `CLAUDE.md`, pre-select a recommended subset. Confirm with `AskUserQuestion`
   (multi-select).
3. **Deselected project skills** — collect their directory paths (project
   relative) into an `--exclude-path` list for the pack script so they are not
   uploaded.
4. **Selected user-scope skills** — stage each into
   `<projectPath>/.claude/skills/<slug>/` so it rides along in the upload zip:
   - Before copying, check whether `<projectPath>/.claude/skills/<slug>` already
     exists. If it does (a name collision with a project skill), surface it to
     the user and ask whether to keep the project version or overwrite — do NOT
     silently clobber.
   - Copy the non-colliding skills in. **Track every staged path** so you can
     remove exactly those after the deploy (Step 10). Staging mutates the working
     tree transiently; the cleanup step removes it.

Record the final selected skill set (project-relative paths) for the manifest.

### Step 8 — Request an upload URL

Call `create_project_upload`:

```json
{ "agentId": "<agent URL or UUID>" }
```

On `status: "ready"` you get `{ uploadId, uploadUrl, maxBytes, expiresAt }`. On
`status: "blocked"`, report the reason (e.g. `agent_must_be_claude_agent_sdk`)
and stop (and remove any staged skills first).

Tip: on a first deploy you can preview with a dry run before requesting the URL:

```bash
bash <skill-dir>/scripts/pack-and-upload.sh --cwd <projectPath> --dry-run \
  --exclude-path <deselected-skill-dir> ...
```

It prints `{"fileCount":N,"zipBytes":B,"skippedCount":K,"skipped":[...]}`.

### Step 9 — Pack and upload, then finalize

Pack and upload promptly (the URL is single-use and time-limited). Pass every
`--exclude-path` from Step 7 and `maxBytes` through:

```bash
bash <skill-dir>/scripts/pack-and-upload.sh \
  --cwd <projectPath> --url "<uploadUrl>" --max-bytes <maxBytes> \
  --exclude-path <deselected-skill-dir> ...
```

On success it prints `{"uploaded":true,"fileCount":N,...}`. On
`{"uploaded":false,"error":"..."}`, surface the error and stop (do not finalize).

Then finalize:

```json
{ "agentId": "<agent URL or UUID>", "uploadId": "<uploadId>", "overwrite": <overwrite> }
```

On `status: "blocked"`, show `reasons` and offending `candidates`, then help the
user fix them (remove the file, or rerun with `--overwrite` for
`files_already_exist`).

### Step 10 — Clean up, write the manifest, report

1. **Remove staged skills** — delete exactly the paths you staged in Step 7,
   whether the deploy succeeded or failed, so the working tree is left as you
   found it.
2. **Write `<projectPath>/.runbear/deploy.json`** — only on a successful
   finalize. Include `version: 1`, `agentId`, `agentName`, the recorded `mcps`
   (no secrets), the selected `skills`, and `lastDeployedAt`.
3. **Offer to connect Slack** (Step 11).
4. **Report** (see Success response).

### Step 11 — Offer to connect Slack

A deployed agent isn't reachable by your colleagues until it's connected to a
channel. After a successful finalize, check whether the agent is already on
Slack and offer to fix it if not.

1. **Check existing installations** — call `list_slack_installations` for
   `agentId`.
   - **One or more installations** ⇒ the agent is already connected. Don't
     prompt; just show its Slack status in the report (`slack: connected —
     <workspace / bot name>`).
   - **None** (empty list, or a "no installations" result) ⇒ the agent has no
     Slack channel yet.
2. **Ask, only when not connected and this is an interactive deploy** (first
   deploy, or a redeploy invoked with edit flags): use `AskUserQuestion` (the
   interactive UI, never a plain-text yes/no prompt) —
   *"This agent isn't connected to Slack yet, so your team can't reach it.
   Connect it to Slack now?"* with options **Connect now** and **Not now**.
   - **Connect now** ⇒ hand off to the `runbear:connect-slack` skill for this
     agent (invoke it as `runbear:connect-slack "<agentName>"`). Do not
     reimplement the Slack flow here — that skill owns the custom-bot setup link
     and channel-joining.
   - **Not now** ⇒ skip; the report's `next:` pointer tells them how to do it
     later.
3. **Silent redeploy** (manifest present, no edit flags): never prompt. Still run
   the installations check and include the Slack status line in the report, with
   the `connect-slack` pointer when it isn't connected.

## Redeploy (manifest present)

With a valid manifest and no edit flags, run **without re-prompting**: request an
upload URL, pack+upload (staging the saved user-scope skills and excluding
deselected ones exactly as before), finalize, and re-attach the saved MCP set.

- Re-attaching uses the same keys/config, so it is **idempotent** (the backend
  upserts) — no duplicate integrations.
- Secret prompts still fire for any secret-bearing MCP whose local secret must be
  re-read from `claude mcp get`.
- Re-surface the `needs-oauth:` callout for any saved shared-OAuth MCP
  (`auth.type: "oauth"` + `userType: "app"`). The skill can't verify whether the
  connection was ever completed, so it reminds on every redeploy until the user
  confirms it's done — and can mint the connect link on request (see
  **Connecting a shared-OAuth MCP**).
- After finalizing, call `list_agent_tools` before and after to **report a diff**
  of attached tools, plus the skills added/removed.
- If a saved MCP no longer exists locally (or its secret is gone), **skip it with
  a warning and leave it attached on the agent** — only detach on an explicit
  `--remove-mcp`.

Edit flags adjust the saved set, then the manifest is rewritten to match:

- `--add-mcp <name>` — run that MCP through Steps 4–6 (resolve → auth → attach).
- `--remove-mcp <name>` — find the integration id via `list_agent_tools`
  (match the manifest's `runbearKey`) and call `detach_tool`.
- `--add-skill <path>` — stage/include it per Step 7.
- `--remove-skill <path>` — add it to the `--exclude-path` list so it is not
  re-uploaded. Note: already-deployed skill files are removed from the workspace
  only if the finalize/workspace API supports deletion; if it does not, say so.

## Success response

```txt
✅ Project deployed
agent:   <agentName>
files:   <fileCount> written  (<K> filtered out locally)
mcps:    <name (shared|per-user)>, ...
         un-deployable: <name — reason + web-UI link>   (if any)
needs-oauth: <name (shared)>, ...   — not yet authorized; these tools return
         nothing until connected. Ask me to "connect <name>" and I'll mint a
         private one-time link (shared OAuth can't carry your local login).  (only if any)
skills:  <deployed skill slugs>
slack:   connected — <workspace / bot>   |   not connected
next:    <only when Slack isn't connected and the user declined / it was a
         silent redeploy>  /runbear:connect-slack "<agentName>"   — connect it
         to Slack for your team
```

Always print the `needs-oauth:` section when one or more shared-OAuth MCPs were
attached (Step 6). Do not treat the deploy as fully done while it is non-empty —
those tools return zero callable functions in the agent until the shared account
is connected. List the MCP names only; do **not** print connect links here.

## Connecting a shared-OAuth MCP (on request)

When the user asks to connect one of the `needs-oauth` MCPs (e.g. "connect
profound"), mint the link **on demand** — never preemptively:

1. Resolve the integration `id` — reuse the id recorded at attach time, or call
   `list_agent_tools` and match the MCP's key (`custom:<localName>` /
   `managed:<slug>`).
2. Call `generate_integration_connect_link` with `{ agentId, integrationId }`.
   - `{ authUrl }` → share the link with **this user only, here** (their own
     session). Tell them: open it, sign in to the provider, done — completing it
     stores the org-shared credential, so every user and agent run reuses it.
     NEVER paste it into a shared Slack channel or any broadcast surface — a
     leaked connect link lets anyone holding it authorize into your vault.
   - `{ authUrl: null, alreadyConnected: true }` → already connected; tell them
     it's ready, nothing to do.
   - `auth_url_not_applicable` → the row is static/no-auth/stdio, or per-user
     (`userType: "user"`); per-user integrations are connected by each end-user
     through the agent's own prompt, not a shared link.
3. This is the same Runbear-hosted OAuth link the per-user lazy-auth flow
   surfaces in Slack — reused here, not a new URL scheme.

## Blocked response

```txt
❌ Project deploy blocked
reasons:
- <backend reason>
candidates:
- <offending path>
```

Common `reasons`:

- From `create_project_upload`: `invalid_agent_id`,
  `agent_not_found_or_not_readable`, `agent_must_be_claude_agent_sdk`,
  `agent_modify_permission_required`, `workspace_gcs_bucket_not_configured`.
- From `finalize_project_upload`: `upload_not_found`, `invalid_zip`,
  `zip_too_large`, `too_many_files`, `upload_too_large`, `encrypted_zip_entry`,
  `files_already_exist` (rerun with `--overwrite`), and per-file
  `secret_detected:<label>:<path>` / `env_file_not_supported:<path>` /
  `forbidden_directory:<path>` / `forbidden_config_file:<path>` /
  `invalid_path:<path>`.

## Known limitations

- **stdio-only MCPs can't deploy.** A locally-configured stdio MCP (an
  npx/uvx/command server) can only reach the hosted agent through a Runbear
  catalog equivalent. With no catalog match it is reported as un-deployable —
  configure it in the Runbear web UI if a hosted equivalent exists.
- **Secret exposure for static-auth custom MCPs.** Attaching a custom MCP whose
  credential is a static token (or a secret in the URL) requires reading that
  secret into the model context to vault it. That is unavoidable for this path;
  it only happens after you confirm the per-MCP secret prompt.
- **Shared OAuth can't carry your local login.** For an OAuth MCP, a deploy only
  registers the server — it never uploads a credential. Claude Code's OAuth
  tokens live in your OS keychain (not in `claude mcp get` output) and are bound
  to Claude Code's own OAuth client, so they can't be transplanted into Runbear's
  vault, and jamming the short-lived access token in as a static `Authorization`
  header would break at the first (~1h) refresh. A **shared** (`userType: "app"`)
  OAuth MCP must therefore be connected once — either in the Runbear web UI
  (`/agents/<agentId>/integrations`) or via the on-request connect link the skill
  mints with `generate_integration_connect_link` (see **Connecting a shared-OAuth
  MCP**); a **per-user** one is authorized by each colleague on first use. Until
  then the MCP is attached but exposes **zero** callable tools — the skill flags
  these in the report's `needs-oauth:` section.
