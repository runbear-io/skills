# Runbear Skills

Skills for exposing Claude Agent via HTTP, Slack, and Discord.

## Table of Contents

- [Use Cases](#use-cases)
- [Installation](#installation)
- [dispatch-http](#dispatch-http)
- [dispatch-slack](#dispatch-slack)
- [dispatch-discord](#dispatch-discord)
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

## License

MIT
