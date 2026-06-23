---
description: Upload local Claude skill folder(s) to a Runbear Claude Agent SDK agent through the Runbear `upload_local_skill_to_agent` MCP tool. Use when the user wants to deploy, install, register, push, or upload a local skill (a folder containing one or more SKILL.md files) to a hosted Runbear agent identified by an app URL or app UUID.
argument-hint: "<skill-path> --agent <appId-or-url> [--overwrite]"
---

# Upload Local Skill to Runbear

Deploy existing local Claude skill(s) to a Runbear Agent SDK app through the Runbear
MCP tool `upload_local_skill_to_agent`.

The backend MCP tool deploys **one skill per call**. If the provided folder contains
multiple `SKILL.md` files, treat it as a migration/import folder and call the backend
once per discovered skill.

## Prerequisites

- The **Runbear management MCP server must be connected** in this Claude Code session —
  it is what exposes `upload_local_skill_to_agent`. If the tool is unavailable, tell
  the user to connect the Runbear MCP first and stop.
- You need the target **Runbear Agent SDK app URL or app UUID** (the `<appId>`). Unlike
  the in-agent `skill-manager` flow, this command runs outside the agent, so the agent
  must be named explicitly via `--agent`.

## Usage

```txt
/skill-uploader:upload ./my-skill --agent https://app.runbear.io/agents/<appId>
/skill-uploader:upload ./my-skill --agent <appId>
/skill-uploader:upload ./my-skill --agent <appId> --overwrite
/skill-uploader:upload ./internal-skills --agent <appId>
```

## Required inputs

- Local skill folder path, or a parent folder containing multiple skill folders
- Runbear Agent SDK app URL or app UUID (`--agent`)
- Optional `--overwrite`

If either required input is missing, ask for the missing value only.

## Safety rules

- Read files only under the provided local folder.
- Do not follow symlinks while inspecting the folder.
- Do not upload `.env`, secrets, `.mcp.json`, `.claude/settings.json`, `.claude.json`,
  archives, scripts, code files, `.git`, or `node_modules`.
- Backend v0 supports exactly one `SKILL.md` per MCP call. This command may process
  multiple discovered skills by uploading them one by one.
- Treat local preflight as convenience only; the backend validation result is
  authoritative.
- Never ask the user for GCS bucket names, GCS paths, or GCS credentials.

## Steps

1. Parse the arguments into `skillPath`, `agentId`, and `overwrite`.
2. Inspect the local folder recursively, preserving relative paths from `skillPath`.
3. Preflight block if there is no `SKILL.md` or any forbidden file shape listed above.
4. If exactly one `SKILL.md` is found, upload that skill once.
5. If multiple `SKILL.md` files are found, upload each skill independently:
   - For each `SKILL.md`, send exactly that file's relative path and content in a
     separate MCP call.
   - Do not send multiple `SKILL.md` files in one backend call.
   - Continue after a blocked skill so the user can see per-skill results.
   - Preserve the user's `overwrite` choice for every per-skill call.
6. Read each `SKILL.md` as UTF-8.
7. Call the Runbear MCP tool `upload_local_skill_to_agent` once per skill:

```json
{
  "agentId": "<agent URL or UUID>",
  "files": [
    {
      "relativePath": "SKILL.md",
      "content": "<file content>"
    }
  ],
  "overwrite": false
}
```

8. Show the backend result directly for single-skill uploads, or a compact per-skill
   summary for migration folders.

## Success response

```txt
✅ Skill uploaded
agent: <agent name if available>
slug: <slug>
path: .claude/skills/<slug>/SKILL.md
next: mention the Runbear Slack agent again; Agent SDK skills are loaded on the next activation
```

## Blocked response

```txt
❌ Skill upload blocked
reasons:
- <backend reason>
```

If the backend reports `skill_already_exists`, explain that the user can rerun with
`--overwrite`.

## Multi-skill migration response

```txt
✅ Uploaded
- cs-org-lookup: .claude/skills/cs-org-lookup/SKILL.md
- langfuse-log-lookup: .claude/skills/langfuse-log-lookup/SKILL.md

❌ Blocked
- usage-summary: secret_detected:database_url_with_password:usage-summary/SKILL.md

next: mention the Runbear Slack agent again; Agent SDK skills are loaded on the next activation
```
