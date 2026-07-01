#!/usr/bin/env bash
#
# pack-and-upload.sh — filter a local Claude Code project, zip it, and PUT the
# archive to a Runbear-issued GCS signed URL. No file contents pass through the
# model, so deploying a large project costs O(1) tokens.
#
# Usage:
#   pack-and-upload.sh --project <path> --url <signedUploadUrl> [--max-bytes N]
#   pack-and-upload.sh --project <path> --dry-run          # preview, no upload
#
# Output: a JSON object on stdout, e.g.
#   {"uploaded":true,"fileCount":42,"zipBytes":83912,"skippedCount":3,"skipped":[...]}
# On failure it prints {"uploaded":false,"error":"..."} and exits non-zero.
#
# The signed URL is single-use and expires; run this promptly after
# create_project_upload, then call finalize_project_upload.
#
# Portable to macOS's default bash 3.2 (no mapfile, no python) and POSIX tools.

set -eu

PROJECT=""
URL=""
MAX_BYTES=0
DRY_RUN=0

while [ $# -gt 0 ]; do
  case "$1" in
    --project) PROJECT="${2:-}"; shift 2 ;;
    --url) URL="${2:-}"; shift 2 ;;
    --max-bytes) MAX_BYTES="${2:-0}"; shift 2 ;;
    --dry-run) DRY_RUN=1; shift ;;
    *) printf '{"uploaded":false,"error":"unknown argument: %s"}\n' "$1"; exit 2 ;;
  esac
done

fail() { printf '{"uploaded":false,"error":"%s"}\n' "$1"; exit 1; }

[ -n "$PROJECT" ] || fail "missing --project"
[ -d "$PROJECT" ] || fail "project path is not a directory: $PROJECT"
[ "$DRY_RUN" -eq 1 ] || [ -n "$URL" ] || fail "missing --url (or pass --dry-run)"
command -v zip >/dev/null 2>&1 || fail "the 'zip' command is required but not installed"
[ "$DRY_RUN" -eq 1 ] || command -v curl >/dev/null 2>&1 || fail "the 'curl' command is required but not installed"

PROJECT_ABS="$(cd "$PROJECT" && pwd)"

# Paths we never upload. The backend also blocks these, but filtering here keeps
# the deploy from being rejected wholesale and avoids leaking secrets to storage.
EXCLUDE_RE='(^|/)(\.git|node_modules|dist|build|\.next|\.turbo|\.omc|coverage|\.venv|venv|vendor|__pycache__|\.pytest_cache|\.mypy_cache)(/|$)|(^|/)\.env(\..*)?$|(^|/)\.mcp\.json$|(^|/)\.claude\.json$|(^|/)\.claude/settings(\.local)?\.json$|(^|/)\.DS_Store$'

# Secret content patterns — skip any text file that matches so a stray key does
# not fail the whole server-side deploy. grep -I skips binary files.
SECRET_RE='-----BEGIN [A-Z ]*PRIVATE KEY-----|AKIA[0-9A-Z]{16}|sk-[A-Za-z0-9_-]{32,}|gh[pousr]_[A-Za-z0-9_]{30,}|xox[baprs]-[A-Za-z0-9-]{20,}|AIza[0-9A-Za-z_-]{35}|(postgres|postgresql|mysql|mongodb)://[^[:space:]:@]+:[^[:space:]@]+@'

cd "$PROJECT_ABS"

# Enumerate candidate files (project-relative). Prefer git: it honours .gitignore
# and skips .git/. --others --exclude-standard also picks up new, un-ignored files.
list_files() {
  if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    git ls-files --cached --others --exclude-standard
  else
    find . -type f | sed 's|^\./||'
  fi
}

# Collect kept + skipped into newline-delimited temp files (bash 3.2 safe).
WORK="$(mktemp -d "${TMPDIR:-/tmp}/runbear-deploy.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT
KEEP_LIST="$WORK/keep.txt"
SKIP_LIST="$WORK/skip.txt"
: > "$KEEP_LIST"
: > "$SKIP_LIST"

while IFS= read -r f; do
  [ -n "$f" ] || continue
  if printf '%s' "$f" | grep -qE -e "$EXCLUDE_RE"; then
    printf '%s\n' "$f" >> "$SKIP_LIST"
    continue
  fi
  if grep -IlE -e "$SECRET_RE" -- "$f" >/dev/null 2>&1; then
    printf '%s (secret)\n' "$f" >> "$SKIP_LIST"
    continue
  fi
  printf '%s\n' "$f" >> "$KEEP_LIST"
done < <(list_files)

KEEP_COUNT=$(grep -c '' "$KEEP_LIST" || true)
SKIP_COUNT=$(grep -c '' "$SKIP_LIST" || true)
[ "${KEEP_COUNT:-0}" -gt 0 ] || fail "no eligible files to deploy after filtering"

# Build a JSON array from a newline-delimited file, escaping backslash and quote.
json_array_from_file() {
  awk 'BEGIN{printf "["} {gsub(/\\/,"\\\\"); gsub(/"/,"\\\"");
       printf "%s\"%s\"", (NR>1?",":""), $0} END{printf "]"}' "$1"
}

SKIPPED_JSON="$(json_array_from_file "$SKIP_LIST")"

ZIPFILE="$WORK/project.zip"
zip -q -X -@ "$ZIPFILE" < "$KEEP_LIST"
ZIP_BYTES=$(wc -c < "$ZIPFILE" | tr -d '[:space:]')

if [ "$MAX_BYTES" -gt 0 ] && [ "$ZIP_BYTES" -gt "$MAX_BYTES" ]; then
  fail "zip is ${ZIP_BYTES} bytes, exceeds max ${MAX_BYTES}; deploy a smaller subset"
fi

if [ "$DRY_RUN" -eq 1 ]; then
  printf '{"uploaded":false,"dryRun":true,"fileCount":%d,"zipBytes":%d,"skippedCount":%d,"skipped":%s}\n' \
    "$KEEP_COUNT" "$ZIP_BYTES" "$SKIP_COUNT" "$SKIPPED_JSON"
  exit 0
fi

HTTP_CODE=$(curl -sS -o /dev/null -w '%{http_code}' \
  -X PUT \
  -H 'Content-Type: application/zip' \
  --data-binary "@${ZIPFILE}" \
  "$URL") || fail "upload failed (curl error)"

case "$HTTP_CODE" in
  200|201) ;;
  *) fail "upload rejected by storage: HTTP $HTTP_CODE" ;;
esac

printf '{"uploaded":true,"fileCount":%d,"zipBytes":%d,"skippedCount":%d,"skipped":%s}\n' \
  "$KEEP_COUNT" "$ZIP_BYTES" "$SKIP_COUNT" "$SKIPPED_JSON"
