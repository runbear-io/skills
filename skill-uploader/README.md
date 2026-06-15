# skill-uploader

Upload local Claude skills to a [Runbear](https://runbear.io) **Claude Agent SDK**
agent — no GCS access required.

It bundles two things that otherwise have to be set up separately:

1. The `/upload-local-skill-to-runbear` slash command.
2. The hosted Runbear MCP server (`https://api.runbear.io/mcp`, OAuth) that the
   command calls.

Install the plugin once and both are wired up together.

## Install

```bash
/plugin marketplace add runbear-io/skills
/plugin install skill-uploader@runbear-skills
```

## Use

```bash
/upload-local-skill-to-runbear ./my-skill --agent <appId or https://app.runbear.io/agents/...>
```

The first tool call opens a Runbear sign-in window (OAuth 2.0, scoped to your
user and organization) — you never paste an API key or token. The command reads
the local skill folder, validates it, and the Runbear backend writes the
`SKILL.md` to the target agent's workspace at `.claude/skills/{slug}/SKILL.md`.
The skill loads on the agent's next activation.

See the command for the full contract:
[`commands/upload-local-skill-to-runbear.md`](./commands/upload-local-skill-to-runbear.md).

## Requirements

- An MCP client that supports **remote servers with OAuth** (Claude Code,
  Claude Desktop, Cursor, …).
- A Runbear account with `write:agents` scope and modify permission on the
  target agent.
- The target must be a **Claude Agent SDK** agent.

See the [Runbear MCP server docs](https://docs.runbear.io/api-reference/mcp-server).
