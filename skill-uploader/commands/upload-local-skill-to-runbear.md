---
description: Upload local Claude skill folder(s) to one Runbear Claude Agent SDK agent via the Runbear MCP server.
argument-hint: ./my-skill --agent <appId|url> [--overwrite]
---

# Upload Local Skill to Runbear

Upload local Claude skill folder(s) to one Runbear Claude Agent SDK agent: $ARGUMENTS

## Usage

```txt
/upload-local-skill-to-runbear ./my-skill --agent https://app.runbear.io/agents/<appId>
/upload-local-skill-to-runbear ./my-skill --agent <appId>
/upload-local-skill-to-runbear ./my-skill --agent <appId> --overwrite
/upload-local-skill-to-runbear ./internal-skills --agent <appId>
```

## Task

You are helping the user deploy existing local Claude skill(s) to a Runbear Agent SDK app through the Runbear MCP tool `upload_local_skill_to_agent`.

This plugin bundles the hosted Runbear MCP server (`runbear`, `https://api.runbear.io/mcp`). The first time you call the tool, your client opens a Runbear sign-in window to authorize access — you never paste an API key or token by hand.

The backend MCP tool deploys **one skill per call**. If the provided folder contains multiple `SKILL.md` files, treat it as a migration/import folder and call the backend once per discovered skill.

## Required inputs

- Local skill folder path, or a parent folder containing multiple skill folders
- Runbear Agent SDK app URL or app UUID
- Optional `--overwrite`

If either required input is missing, ask for the missing value only.

## Safety rules

- Read files only under the provided local folder.
- Do not follow symlinks while inspecting the folder.
- Do not upload `.env`, secrets, `.mcp.json`, `.claude/settings.json`, `.claude.json`, archives, scripts, code files, `.git`, or `node_modules`.
- Backend v0 supports exactly one `SKILL.md` per MCP call. The local command may process multiple discovered skills by uploading them one by one.
- Treat local preflight as convenience only; the backend validation result is authoritative.
- Never ask the user for GCS bucket names, GCS paths, or GCS credentials.

## Steps

1. Parse `$ARGUMENTS` into `skillPath`, `agentId`, and `overwrite`.
2. Inspect the local folder recursively, preserving relative paths from `skillPath`.
3. Preflight block if there is no `SKILL.md` or any forbidden file shape listed above.
4. If exactly one `SKILL.md` is found, upload that skill once.
5. If multiple `SKILL.md` files are found, upload each skill independently:
   - For each `SKILL.md`, send exactly that file's relative path and content in a separate MCP call.
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

8. Show the backend result directly for single-skill uploads, or a compact per-skill summary for migration folders.

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

If the backend reports `skill_already_exists`, explain that the user can rerun with `--overwrite`.

## Multi-skill migration response

```txt
✅ Uploaded
- cs-org-lookup: .claude/skills/cs-org-lookup/SKILL.md
- langfuse-log-lookup: .claude/skills/langfuse-log-lookup/SKILL.md

❌ Blocked
- usage-summary: secret_detected:database_url_with_password:usage-summary/SKILL.md

next: mention the Runbear Slack agent again; Agent SDK skills are loaded on the next activation
```
