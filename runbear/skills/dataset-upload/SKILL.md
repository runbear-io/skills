---
description: Package a large local document or spreadsheet directory into resumable tar shards, upload it through the Runbear management MCP, and publish it read-only to a hosted Claude Agent SDK agent. Use when a dataset is too large for `runbear:deploy`, including investor diligence folders, analytics exports, spreadsheets, PDFs, and filesystem-backed question-answering collections.
argument-hint: "<source> --agent <appId-or-url-or-name> --dataset-name <name> [--overwrite]"
allowed-tools: Bash, Read, mcp__*__list_agents, mcp__*__get_agent, mcp__*__create_dataset_upload, mcp__*__finalize_dataset_upload, mcp__*__get_dataset_upload_status
---

# Upload a Large Dataset to Runbear

Publish a local directory as a read-only dataset for an existing Runbear Claude Agent SDK agent. This flow is separate from `runbear:deploy`: project deploy is for source and agent configuration; dataset upload is for large document collections.

## Requirements

- The Runbear management MCP server must be connected and expose `create_dataset_upload`, `finalize_dataset_upload`, and `get_dataset_upload_status`.
- The target must be a Claude Agent SDK agent.
- `python3` is required for the bundled packaging and resumable-upload helpers.
- Published datasets are currently mounted only by agent-worker deployments using the `local-asrt` Filestore workspace mode. Do not claim that a dataset is usable from a `k8s-pod` sandbox.

## Safety rules

- Never upload `.env`, `.env.*`, `.mcp.json`, `.claude.json`, or Claude settings files.
- Stop on symlinks, devices, sockets, or other non-regular filesystem entries. Do not dereference them.
- Do not print, persist, or repeat GCS resumable session URLs outside the upload command that consumes each URL.
- Do not delete local shards until the server reports the ingest job as `completed`.
- Do not retry `finalize_dataset_upload` with a different manifest or dataset name for the same upload ID.

## Inputs

Parse the arguments into:

- `source`: first positional argument, a local directory containing the dataset.
- `target`: `--agent`, accepting an agent UUID, Runbear agent URL, or unambiguous agent name.
- `datasetName`: `--dataset-name`, lowercase letters, numbers, and hyphens, 1–64 characters.
- `overwrite`: false unless `--overwrite` is present.

If a required input is missing, ask only for that value. Resolve an agent name with `list_agents`; never guess when more than one agent matches. The backend validates UUIDs and URLs.

## Workflow

### 1. Package deterministic uncompressed tar shards

`<skill-dir>` below is this skill's base directory, containing this `SKILL.md`.

```bash
OUTPUT_DIR="$(mktemp -d -t runbear-dataset-upload.XXXXXX)"
python3 "<skill-dir>/scripts/package-dataset.py" \
  --source "<source>" \
  --output "$OUTPUT_DIR" \
  --dataset-name "<datasetName>"
```

Read `$OUTPUT_DIR/manifest.json`. It contains the ordered `shards` array required by the MCP tools. Each shard is an uncompressed tar, at most 512 MiB, with SHA-256 and file-count metadata. The complete upload is capped at 64 shards, 20 GiB of tar data, and 200,000 files.

Before uploading, report only the source path, dataset name, shard count, total archive bytes, and file count. Do not dump the full manifest when it is large.

### 2. Create resumable upload sessions

Call `create_dataset_upload` with:

- `agentId`: the resolved target.
- `datasetName`: the manifest dataset name.
- `shards`: only `index`, `sizeBytes`, `sha256`, and `fileCount` from each manifest shard.

The response returns one upload URL per ordered shard. Confirm that every returned index has exactly one matching local manifest entry. Do not write the URLs into the manifest or another file.

### 3. Upload every shard with resume support

For each returned shard, invoke the helper with the matching local `path`:

```bash
python3 "<skill-dir>/scripts/upload-shard.py" \
  --url "<resumableUploadUrl>" \
  --file "<localShardPath>"
```

The helper queries the session offset and sends only the remaining bytes. If a transfer fails, keep the shard directory and rerun the same command with the same session URL. If the session has expired, create a new upload ID and upload every shard under the new sessions; never mix shards from two upload IDs.

### 4. Finalize ingestion

After every upload command succeeds, call `finalize_dataset_upload` with the same `agentId`, `uploadId`, `datasetName`, ordered shard metadata, and `overwrite` value.

Record the returned `jobId`. Finalization only enqueues ingestion; it does not mean the dataset is ready.

### 5. Poll until terminal

Call `get_dataset_upload_status` with the same `agentId`, `uploadId`, and `datasetName` until:

- `completed`: report the returned `datasetPath`, then delete the local output directory.
- `failed`: report `failedReason` and keep local shards so the user can inspect or restart with a new upload ID.
- another state: wait with bounded backoff, starting at 5 seconds and capping at 30 seconds.

Never tell the user the dataset is available before the state is `completed`.

## Expected agent behavior

On later activations, the target agent receives the published dataset root as a read-only Agent SDK additional directory and in its system prompt. It should inspect specific files in place instead of copying the dataset tree into its writable workspace.
