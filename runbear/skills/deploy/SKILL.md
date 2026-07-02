---
description: Deploy a local Claude Code project to a Runbear Claude Agent SDK agent's workspace file system through the Runbear signed-URL upload flow (`create_project_upload` + `finalize_project_upload` MCP tools). Use when the user wants to deploy, publish, push, sync, or upload a local project (its files, CLAUDE.md, skills, agents, docs, and code) to a hosted Runbear Agent SDK agent identified by an app UUID or agent URL.
argument-hint: "<project-path> --agent <appId-or-url> [--overwrite]"
allowed-tools: Bash, Read, mcp__*__create_project_upload, mcp__*__finalize_project_upload
---

# Deploy Local Project to Runbear

Deploy a local Claude Code project to a Runbear Claude Agent SDK agent so the hosted
agent runs against the same `CLAUDE.md`, skills, subagents, docs, and code you have
locally. Files are written to the agent's workspace file system at their relative
paths, preserving the directory layout (including code and binary assets).

**How it works (token-efficient):** the project files are packed into a zip and
uploaded directly to storage via a short-lived signed URL — the file contents never
pass through the model's context, so deploying a large project costs a near-constant
number of tokens. The flow is three steps:

1. `create_project_upload` (MCP) → returns a signed upload URL.
2. `scripts/pack-and-upload.sh` → filters, zips, and PUTs the archive to that URL.
3. `finalize_project_upload` (MCP) → the backend unzips, validates, and writes the
   files into the agent workspace.

Unlike `skill-uploader:upload` (a single `SKILL.md`), this deploys the **whole
project**.

## Prerequisites

- The **Runbear management MCP server must be connected** in this Claude Code session —
  it exposes `create_project_upload` and `finalize_project_upload`. If those tools are
  unavailable, tell the user to connect the Runbear MCP first and stop.
- The target **Runbear Agent SDK app UUID or agent URL** (`--agent`). This command runs
  outside the agent, so the target must be named explicitly.
- The target agent must be of type **Claude Agent SDK** (the backend rejects others with
  `agent_must_be_claude_agent_sdk`).
- Local tools: `git`, `zip`, and `curl` on PATH.

## Usage

```txt
/runbear:deploy . --agent https://app.runbear.io/agents/<appId>
/runbear:deploy ./my-project --agent <appId>
/runbear:deploy ./my-project --agent <appId> --overwrite
```

## Required inputs

- Local project folder path (defaults to `.` if omitted).
- Runbear Agent SDK app UUID or agent URL (`--agent`, or a bare UUID argument).
- Optional `--overwrite` to replace files that already exist in the agent workspace.

If the agent target is missing, ask for it only. Do not guess a UUID.

## Safety rules

- The packing script filters files by path and pre-scans text files for secrets; the
  backend re-validates authoritatively after unzip. Both layers block:
  - Secrets / env: `.env`, `.env.*`, and any file containing API keys, tokens, private
    keys, bearer tokens, or `postgres://user:pass@` URLs.
  - Credential/agent config: `.mcp.json`, `.claude/settings.json`,
    `.claude/settings.local.json`, `.claude.json`.
  - `.git/`, `node_modules/`, and build/dep output (`dist/`, `build/`, `.next/`,
    `.turbo/`, `.omc/`, `coverage/`, `.venv/`, `vendor/`, `__pycache__/`).
- The script respects `.gitignore` (via `git ls-files`).
- The backend caps a deploy at **500 files** / **25 MiB decompressed** / **50 MiB zip**.
  If the project is larger, deploy a meaningful subset and tell the user what you left
  out. Never silently truncate.
- Do not read project file contents into your own context just to deploy them — let the
  script handle the bytes. That is the whole point of the signed-URL flow.
- Never ask the user for GCS bucket names, paths, or credentials.

## Steps

1. Parse arguments into `projectPath` (default `.`), `agentId` (from `--agent` or a bare
   UUID/URL argument), and `overwrite` (default false).
2. **Preview (optional but recommended for a first deploy):** run the packing script in
   dry-run mode so you and the user can see what will be sent and what is filtered out,
   without uploading:

   ```bash
   bash <skill-dir>/scripts/pack-and-upload.sh --project <projectPath> --dry-run
   ```

   It prints `{"fileCount":N,"zipBytes":B,"skippedCount":K,"skipped":[...]}`. If the file
   count or skipped list looks wrong, fix filters/paths before deploying.
3. **Request an upload URL:** call `create_project_upload`:

   ```json
   { "agentId": "<agent URL or UUID>" }
   ```

   On `status: "ready"` you get `{ uploadId, uploadUrl, maxBytes, expiresAt }`. On
   `status: "blocked"`, report the reason (e.g. `agent_must_be_claude_agent_sdk`) and
   stop.
4. **Pack and upload** promptly (the upload URL is single-use and time-limited).
   Pass `maxBytes` through so an oversized zip fails locally instead of at storage:

   ```bash
   bash <skill-dir>/scripts/pack-and-upload.sh \
     --project <projectPath> --url "<uploadUrl>" --max-bytes <maxBytes>
   ```

   On success it prints `{"uploaded":true,"fileCount":N,"zipBytes":B,...}`. If it prints
   `{"uploaded":false,"error":"..."}`, surface the error and stop (do not finalize).
5. **Finalize:** call `finalize_project_upload`:

   ```json
   { "agentId": "<agent URL or UUID>", "uploadId": "<uploadId>", "overwrite": false }
   ```

6. Show the result. On `status: "deployed"`, report `fileCount` and the target agent
   name. On `status: "blocked"`, show `reasons` and offending `candidates`, then help
   the user fix them (remove the file, or rerun with `--overwrite` for
   `files_already_exist`).

`<skill-dir>` is this skill's base directory (the folder containing this `SKILL.md`).

## Success response

```txt
✅ Project deployed
agent: <agentName>
files: <fileCount> written to the agent workspace  (<K> filtered out locally)
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

- From `create_project_upload`: `invalid_agent_id`, `agent_not_found_or_not_readable`,
  `agent_must_be_claude_agent_sdk`, `agent_modify_permission_required`,
  `workspace_gcs_bucket_not_configured`.
- From `finalize_project_upload`: `upload_not_found` (URL never uploaded, or expired
  staging), `invalid_zip`, `zip_too_large`, `too_many_files`, `upload_too_large`,
  `encrypted_zip_entry`, `files_already_exist` (rerun with `--overwrite`), and per-file
  `secret_detected:<label>:<path>` / `env_file_not_supported:<path>` /
  `forbidden_directory:<path>` / `forbidden_config_file:<path>` / `invalid_path:<path>`.
