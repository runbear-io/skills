---
description: Deploy a local Claude Code project to a Runbear Claude Agent SDK agent's workspace file system through the Runbear `deploy_project_to_agent` MCP tool. Use when the user wants to deploy, publish, push, sync, or upload a local project (its files, CLAUDE.md, skills, agents, docs, and code) to a hosted Runbear Agent SDK agent identified by an app UUID or agent URL.
argument-hint: "<project-path> --agent <appId-or-url> [--overwrite]"
allowed-tools: Bash, Read, Glob, mcp__*__deploy_project_to_agent
---

# Deploy Local Project to Runbear

Deploy a local Claude Code project to a Runbear Claude Agent SDK agent through the
Runbear MCP tool `deploy_project_to_agent`. Every eligible file under the project is
written to the agent's workspace file system at its relative path, so the hosted
Agent SDK agent runs against the same `CLAUDE.md`, skills, subagents, docs, and code
you have locally.

Unlike `skill-uploader:upload` (which deploys a single `SKILL.md`), this command
deploys the **whole project** and preserves the directory layout, including code and
config files.

## Prerequisites

- The **Runbear management MCP server must be connected** in this Claude Code session —
  it is what exposes `deploy_project_to_agent`. If the tool is unavailable, tell the
  user to connect the Runbear MCP first and stop.
- You need the target **Runbear Agent SDK app UUID or agent URL** (the `<appId>`). This
  command runs outside the agent, so the target must be named explicitly via `--agent`.
- The target agent must be of type **Claude Agent SDK**. The backend rejects other
  agent types with `agent_must_be_claude_agent_sdk`.

## Usage

```txt
/runbear:deploy .
/runbear:deploy . --agent https://app.runbear.io/agents/<appId>
/runbear:deploy ./my-project --agent <appId>
/runbear:deploy ./my-project --agent <appId> --overwrite
```

## Required inputs

- Local project folder path (defaults to the current directory `.` if omitted).
- Runbear Agent SDK app UUID or agent URL (`--agent`).
- Optional `--overwrite` to replace files that already exist in the agent workspace.

If `--agent` is missing, ask for it only. Do not guess a UUID.

## Safety rules

- Read files only under the provided project folder. Do not follow symlinks out of it.
- **Never upload these** (the backend also blocks them, but filter locally first so the
  deploy is not rejected as a whole):
  - Secrets and env files: `.env`, `.env.*`, anything containing API keys, tokens,
    private keys, bearer tokens, or `postgres://user:pass@` style URLs.
  - Config that leaks credentials or rewires the agent: `.mcp.json`,
    `.claude/settings.json`, `.claude/settings.local.json`, `.claude.json`.
  - `.git/`, `node_modules/`, and other dependency/build output directories
    (`dist/`, `build/`, `.next/`, `.turbo/`, `coverage/`, `.venv/`, `vendor/`).
  - Binary and archive files (images, PDFs, `.zip`, `.tar`, `.gz`, lockfiles that are
    huge, compiled artifacts). The backend only accepts UTF-8 text content.
- Respect the project's `.gitignore` — skip anything it ignores.
- The backend caps a deploy at **300 files** and **5 MiB total**. If the project is
  larger, deploy the meaningful subset (e.g. `CLAUDE.md`, `.claude/`, `docs/`, `src/`)
  and tell the user what you skipped. Never silently truncate.
- Treat local filtering as convenience; the backend validation result is authoritative.
- Never ask the user for GCS bucket names, paths, or credentials.

## Steps

1. Parse the arguments into `projectPath` (default `.`), `agentId`, and `overwrite`.
2. Enumerate candidate files under `projectPath`, preserving paths **relative to
   `projectPath`**. Prefer `git ls-files` when the folder is a git repo (it already
   honours `.gitignore` and skips `.git/`); otherwise walk the tree and apply the
   exclusions in "Safety rules". A good default command inside a repo:

   ```bash
   git -C <projectPath> ls-files --cached --others --exclude-standard
   ```

   Then drop any path matching the safety exclusions above.
3. For each remaining file, skip it if it is binary/non-UTF-8 or clearly a secret/env
   file. Read the rest as UTF-8.
4. If the count exceeds 300 files or the total exceeds ~5 MiB, narrow to the meaningful
   subset and note what was left out.
5. Call the Runbear MCP tool `deploy_project_to_agent` **once** with all files:

   ```json
   {
     "agentId": "<agent URL or UUID>",
     "files": [
       { "relativePath": "CLAUDE.md", "content": "<file content>" },
       { "relativePath": ".claude/skills/foo/SKILL.md", "content": "<file content>" },
       { "relativePath": "src/index.js", "content": "<file content>" }
     ],
     "overwrite": false
   }
   ```

6. Show the backend result. On `status: "deployed"`, report the file count and target
   agent. On `status: "blocked"`, show the reasons and the offending `candidates`, then
   help the user fix them (drop the file, or rerun with `--overwrite` for
   `files_already_exist`).

## Success response

```txt
✅ Project deployed
agent: <agentName>
files: <fileCount> written to the agent workspace
next: mention the Runbear agent again; Agent SDK files load on the next activation
```

## Blocked response

```txt
❌ Project deploy blocked
reasons:
- <backend reason>
candidates:
- <offending path>
```

Common `reasons`:

- `invalid_agent_id` — the `--agent` value is not a UUID or a valid Runbear agent URL.
- `agent_not_found_or_not_readable` — no such agent in your org, or no read access.
- `agent_must_be_claude_agent_sdk` — the target is not a Claude Agent SDK agent.
- `agent_modify_permission_required` — you lack write permission on the agent.
- `files_already_exist` — one or more files exist; rerun with `--overwrite` to replace.
- `secret_detected:<label>:<path>` / `env_file_not_supported:<path>` /
  `forbidden_directory:<path>` / `forbidden_config_file:<path>` — remove that file and
  redeploy.
- `too_many_files` / `upload_too_large` — deploy a smaller subset.
