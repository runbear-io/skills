---
description: Package a large local file or directory into compressed resumable tar shards and transfer it into an existing Runbear Agent SDK agent's writable workspace. Use when local files exceed the project deploy limits, including document collections, analytics exports, spreadsheets, PDFs, media, and other large working sets.
argument-hint: "<source> --agent <appId-or-url-or-name> [--name <workspace-directory>] [--compression auto|zstd|gzip|none] [--overwrite]"
allowed-tools: Bash, Read, mcp__*__list_agents, mcp__*__get_agent, mcp__*__create_workspace_upload, mcp__*__finalize_workspace_upload, mcp__*__get_workspace_upload_status
---

# Upload Large Files to a Runbear Workspace

Transfer a local file or directory into an existing Runbear Agent SDK agent's writable workspace. Use `runbear:deploy` for project source and agent configuration. Use this command for a one-shot transfer of larger working files.

## Requirements

- The Runbear management MCP server must expose `create_workspace_upload`, `finalize_workspace_upload`, and `get_workspace_upload_status`.
- The target must be a Runbear Agent SDK agent.
- `python3` is required for the bundled packaging and resumable-upload helpers.

## Safety rules

- Never upload `.env`, `.env.*`, `.mcp.json`, `.claude.json`, or Claude settings files.
- Stop on symlinks, devices, sockets, or any other non-regular filesystem entry. Do not dereference them.
- Do not place `.claude`, `.claude.json`, `.git`, `.mcp.json`, `.pipedream-stash`, or `.runbear` at the workspace root. The packaging helper rejects these top-level entries.
- Do not print, persist, or repeat GCS resumable session URLs outside the upload command that consumes each URL.
- Keep local shards until the server reports `completed`.
- Do not retry `finalize_workspace_upload` with different shard metadata or compression for the same upload ID.

## Inputs

Parse the arguments into:

- `source`: the first positional argument, accepting one local regular file or one local directory.
- `target`: `--agent`, accepting an agent UUID, Runbear agent URL, or unambiguous agent name.
- `layoutName`: optional `--name`. This is a workspace directory name, not a transfer identifier. Preserve it verbatim, including uppercase letters, spaces, underscores, and non-ASCII characters. The helper validates filesystem safety.
- `compression`: optional `--compression`, defaulting to `auto`. Accepted values are `auto`, `zstd`, `gzip`, and `none`.
- `overwrite`: false unless `--overwrite` is present. When true, existing top-level entries with the same names are replaced.

If a required input is missing, ask only for that value. Resolve an agent name with `list_agents`; never guess when more than one agent matches. The backend validates UUIDs and URLs.

## Workspace layout

The packaging helper writes final workspace-relative paths into every tar entry:

- With `--name X`, every entry is placed below `X/`. `--name "Investor_Diligence"` produces paths such as `Investor_Diligence/report.pdf`.
- Without `--name`, a source with one top-level file or directory keeps that entry's name.
- Without `--name`, a source with multiple top-level entries is placed below `upload-YYYYMMDD-HHMMSS/`.

A supplied layout name must not be empty, `.`, or `..`; start with `-` or `.`; contain `/`, NUL, or control characters; or exceed 255 UTF-8 bytes. The transfer itself has no user-defined name. `create_workspace_upload` returns the `uploadId` used by the remaining calls.

## Workflow

### 1. Package deterministic compressed tar shards

`<skill-dir>` below is this skill's base directory, containing this `SKILL.md`.

```bash
OUTPUT_DIR="$(mktemp -d -t runbear-workspace-upload.XXXXXX)"
python3 "<skill-dir>/scripts/package-upload.py" \
  --source "<source>" \
  --output "$OUTPUT_DIR" \
  --compression "<compression>"
```

If `--name` was supplied, append `--name "<layoutName>"` to the packaging command.

Read `$OUTPUT_DIR/manifest.json`. It contains:

- `topLevelPrefix`: the workspace's resulting top-level file or directory name.
- `compression`: the codec selected by the helper.
- `shards`: the ordered local shard list. Each item contains `index`, local `path`, compressed `sizeBytes`, compressed-byte `sha256`, and `fileCount`.
- `totalBytes`: total compressed bytes.
- `totalUncompressedBytes`: total tar bytes before outer compression.
- `totalFileCount`: total regular files.

`auto` tries Python 3.14's `compression.zstd`, the third-party `zstandard` package, and a `zstd` binary, in that order. If none is available, it uses Python's gzip implementation. Explicit `zstd` fails when no zstd implementation is available. The helper prints the selected codec. Shard filenames end in `.tar.zst`, `.tar.gz`, or `.tar`.

The complete transfer is capped at 64 shards, 20 GiB of compressed data, and 200,000 files. No manifest shard exceeds 512 MiB of compressed data.

Before uploading, report only the source path, top-level prefix, selected codec, shard count, compressed bytes, uncompressed tar bytes, and file count. Do not dump the full manifest when it is large.

### 2. Create resumable upload sessions

Call `create_workspace_upload` with:

- `agentId`: the resolved target.
- `compression`: the manifest's `compression` value.
- `shards`: only `index`, `sizeBytes`, `sha256`, and `fileCount` from each manifest shard.

The response returns an `uploadId` and one upload URL per ordered shard. Confirm that every returned index has exactly one matching local manifest entry. Do not write the URLs into the manifest or another file.

### 3. Upload every shard with resume support

For each returned shard, invoke the helper with the matching local `path`:

```bash
python3 "<skill-dir>/scripts/upload-shard.py" \
  --url "<resumableUploadUrl>" \
  --file "<localShardPath>"
```

The helper queries the session offset and sends only the remaining compressed bytes. If a transfer fails, keep the shard directory and rerun the same command with the same session URL. If the session expires, create a new upload ID and upload every shard under the new sessions. Never mix shards from two upload IDs.

### 4. Finalize extraction

After every upload command succeeds, call `finalize_workspace_upload` with the same `agentId`, `uploadId`, `compression`, ordered shard metadata, and `overwrite` value.

Record the returned `jobId`. Finalization only enqueues extraction; it does not mean the files are ready.

### 5. Poll until terminal

Call `get_workspace_upload_status` with the same `agentId` and `uploadId` until:

- `completed`: report the returned `workspacePaths`, then delete the local output directory.
- `failed`: report `failedReason` and keep local shards so the user can inspect them or restart with a new upload ID.
- another state: wait with bounded backoff, starting at 5 seconds and capping at 30 seconds.

Never announce success before the state is `completed`.

## Expected agent behavior

On the next activation, the files are present in the agent's workspace as ordinary writable files. The agent may read, modify, move, or delete them.
