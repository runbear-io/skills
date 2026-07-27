# Runbear Skills

Skills for exposing Claude Agent via HTTP, Slack, and Discord.

## Table of Contents

- [Use Cases](#use-cases)
- [Installation](#installation)
- [dispatch-http](#dispatch-http)
- [dispatch-slack](#dispatch-slack)
- [dispatch-discord](#dispatch-discord)
- [skill-uploader](#skill-uploader)
- [runbear](#runbear)
- [License](#license)

## Use Cases

- **Introduce a Claude Code project to team members** — Let your team interact with a project through Slack or Discord without needing Claude Code installed locally
- **Interact with a Claude Code project running on a Mac Mini** — Access a headless Claude Code instance remotely via HTTP, Slack, or Discord
- **Query a service that uses Claude Code as backend** — Expose Claude Code as a REST API for other services to consume
- **Use Siri to command Claude Code** — Chain Siri Shortcuts with the HTTP API to control Claude Code by voice

## Installation

```bash
/plugin marketplace add runbear-io/skills
/plugin install dispatch-http@runbear-skills
/plugin install dispatch-slack@runbear-skills
/plugin install dispatch-discord@runbear-skills
/plugin install skill-uploader@runbear-skills
/plugin install runbear@runbear-skills
```

## dispatch-http

Expose Claude Code as REST API endpoints.

| Skill | Description |
|-------|-------------|
| `dispatch` | Start an Express server that exposes Claude Code/Cowork via REST endpoints |
| `expose` | Expose the local dispatch-http server to the internet via a Cloudflare quick tunnel |

### Usage

```
/dispatch-http:dispatch
/dispatch-http:dispatch port 8080
/dispatch-http:expose
```

## dispatch-slack

Connect Claude Code to Slack via Socket Mode. Supports streaming responses.

| Skill | Description |
|-------|-------------|
| `dispatch` | Start/stop the Slack bot server that connects Claude Code to Slack |
| `init` | Create and configure a Slack bot app with OAuth token rotation |

### Usage

```
/dispatch-slack:init
/dispatch-slack:dispatch [start|stop|status] [/path/to/project]
```

### Running modes

The `dispatch` skill supports two modes:

- **Local** — Run directly on the host machine. Uses local Claude Code authentication.
- **Docker** — Run in a container for sandboxed filesystem access. Requires `CLAUDE_CODE_OAUTH_TOKEN` (generate with `claude setup-token`) or `ANTHROPIC_API_KEY` in `.env`.

## dispatch-discord

Connect Claude Code to Discord. Supports streaming responses via progressive message editing.

| Skill | Description |
|-------|-------------|
| `dispatch` | Start/stop the Discord bot server that connects Claude Code to Discord |
| `init` | Create and configure a Discord bot via the Developer Portal |

### Usage

```
/dispatch-discord:init
/dispatch-discord:dispatch [start|stop|status] [/path/to/project]
```

### Running modes

The `dispatch` skill supports two modes:

- **Local** — Run directly on the host machine. Uses local Claude Code authentication.
- **Docker** — Run in a container for sandboxed filesystem access. Requires `CLAUDE_CODE_OAUTH_TOKEN` (generate with `claude setup-token`) or `ANTHROPIC_API_KEY` in `.env`.

## skill-uploader

Deploy local Claude skill folder(s) to a hosted Runbear Agent SDK agent. Reads a local
skill folder, runs a safety preflight, and deploys each `SKILL.md` through the Runbear
`upload_local_skill_to_agent` MCP tool.

| Skill | Description |
|-------|-------------|
| `upload` | Upload local skill folder(s) to a Runbear agent identified by an app URL or app UUID |

### Prerequisites

- The **Runbear management MCP server** must be connected in your Claude Code session —
  it provides the `upload_local_skill_to_agent` tool.
- The target **Runbear Agent SDK app URL or app UUID** (`--agent`).

### Usage

```
/skill-uploader:upload ./my-skill --agent https://app.runbear.io/agents/<appId>
/skill-uploader:upload ./my-skill --agent <appId>
/skill-uploader:upload ./my-skill --agent <appId> --overwrite
/skill-uploader:upload ./internal-skills --agent <appId>
```

The backend deploys **one skill per call**. If the folder contains multiple `SKILL.md`
files, each is uploaded independently and reported per skill.

## runbear

Deploy a whole local Claude Code **project** to a hosted Runbear Agent SDK agent **and
configure the MCPs and skills it needs**, so colleagues can use your agent without you
doing it on their behalf. The hosted agent runs against the same `CLAUDE.md`, skills,
subagents, docs, and code you have locally, with the directory layout preserved.

| Skill | Description |
|-------|-------------|
| `deploy` | Deploy a local project's files, select which local MCPs the agent gets (shared vs per-user auth per MCP), and curate its skills — all saved to a committed manifest for one-command redeploys |
| `connect-slack` | Connect a Runbear Agent SDK agent to Slack — creates a workspace-specific custom bot by default, and can join channels |
| `workspace-upload` | Package and transfer large file collections through resumable GCS sessions into a hosted agent's writable workspace |

### What `deploy` configures

- **Files** — uploaded via a signed URL (bytes never pass through the model context).
- **MCPs** — pick from your locally-configured MCP servers (project + user scope);
  each is attached to the agent as a Runbear catalog app (`attach_app`) or a custom
  MCP (`attach_custom_mcp`). Per MCP you choose **shared** auth (one org credential,
  `userType: app`) or **per-user** auth (each colleague signs in as themselves,
  `userType: user` — the default). OAuth MCPs attach cleanly; you're prompted before
  any local secret is read to vault a static-auth MCP.
- **Skills** — curated from your project (`.claude/skills/`) and your user scope
  (`~/.claude/skills/`); the chosen set ships in the upload.
- **AI suggestions** — the skill reads your `CLAUDE.md` and pre-selects a recommended
  MCP/skill set you can accept or edit.
- **Manifest & redeploy** — choices are written to a committed `.runbear/deploy.json`.
  Re-running `deploy` reproduces the exact configuration with no re-prompting;
  `--add-mcp` / `--remove-mcp` / `--add-skill` / `--remove-skill` adjust it.

> **Limitations:** local `stdio` MCPs (npx/uvx/command servers) can only reach the
> hosted agent through a Runbear catalog equivalent — with no match they're reported
> as un-deployable. Vaulting a static-auth custom MCP requires reading its secret into
> context, which only happens after you confirm a per-MCP prompt.

### Upload large workspace files

Use `workspace-upload` when local files exceed the project deploy limits. The skill
creates deterministic compressed tar shards, uploads them through resumable GCS
sessions, and waits until extraction finishes in the agent's writable workspace.

```txt
/runbear:workspace-upload ./diligence \
  --agent https://app.runbear.io/agents/<appId> \
  --name "Investor_Diligence"
```

`--name` is an optional workspace directory name. When supplied, the skill preserves
it verbatim and places every uploaded entry below it. Without `--name`, one top-level
source entry keeps its own name; multiple entries are placed below a generated
`upload-YYYYMMDD-HHMMSS/` directory.

Compression defaults to `auto`: Python's built-in zstd support is preferred, followed
by the `zstandard` package and a `zstd` binary. If none is available, the skill uses
gzip. Pass `--compression zstd`, `gzip`, or `none` to select a codec explicitly.
After completion, the files are ordinary workspace files that the agent can modify
or delete.

### Prerequisites

- The **Runbear management MCP server** must be connected in your Claude Code session —
  it provides `create_project_upload`, `finalize_project_upload`, `search_apps`,
  `attach_app`, `attach_custom_mcp`, `list_agent_tools`, and `detach_tool` (plus
  `create_agent` for the `--new` flow).
- The **`claude` CLI** on PATH — used to enumerate local MCPs (`claude mcp list` /
  `claude mcp get`).
- The target **Runbear Agent SDK app URL, app UUID, or agent name** (the first
  argument) — a name is fuzzy-matched, with an interactive picker when more than one
  agent matches — or `--new "<agentName>"` to create a fresh Claude Agent SDK agent and
  deploy to it. An existing target agent must be of type Claude Agent SDK. Resolving a
  name uses the `list_agents` tool.
- Local tools: `git`, `zip`, and `curl` on PATH.

### Usage

Deploy to an existing agent:

```
/runbear:deploy <appId>
/runbear:deploy https://app.runbear.io/agents/<appId>
/runbear:deploy "My Agent"
/runbear:deploy <appId> --cwd ./my-project
/runbear:deploy "My Agent" --cwd ./my-project --overwrite
```

Or create a new Claude Agent SDK agent and deploy to it in one step:

```
/runbear:deploy --new "My Agent"
/runbear:deploy --new "My Agent" --cwd ./my-project
```

Redeploy with the saved settings (no re-prompting), optionally editing the set:

```
/runbear:deploy "My Agent"
/runbear:deploy "My Agent" --add-mcp linear --remove-skill .claude/skills/old
```

The backend caps a deploy at **500 files** / **25 MiB decompressed** / **50 MiB zip**,
and blocks secrets, `.env`, `.git/`, `.runbear/`, `node_modules/`, `.mcp.json`, and
Claude settings files. Use `--overwrite` to replace files that already exist in the
agent workspace. `.runbear/deploy.json` (the deploy manifest) is committed to your repo
but excluded from the upload.

Connect an agent to Slack (a workspace-specific custom bot by default):

```
/runbear:connect-slack "My Agent"
/runbear:connect-slack <appId> --bot-name "My Bot" --channel project-team
/runbear:connect-slack <appId> --mode default
```

Custom mode returns a Runbear web-app link to finish creating the Slack app; joining
public channels is then handled through the MCP. Use `--mode default` to attach the
shared @Runbear bot instead.

## License

MIT
