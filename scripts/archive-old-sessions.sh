#!/usr/bin/env bash
#
# archive-old-sessions.sh
#
# Session retention for ~/.pi/agent/sessions (per ~/.pi/docs/setup-refactor-plan.md
# Phase 8). Session .jsonl files are NOT deleted by pi automatically and can
# accumulate indefinitely (79M / 115 files observed 2026-08-29, no prior
# archival routine existed).
#
# Session logs may contain file contents, command output, fetched web
# content, and full model/tool results -- treat the resulting archive as
# potentially sensitive (same handling as ~/.pi/agent/sessions itself: not
# committed anywhere, not casually shared).
#
# What this does:
#   1. Finds session .jsonl files older than --days (default 90)
#   2. Tars + gzips them into ~/.pi/session-archives/session-archive-<run-date>.tgz
#      preserving their relative path under sessions/, so they could be
#      restored by extracting into ~/.pi/agent/sessions/ again
#   3. Removes the originals only after the archive is verified readable
#   4. Removes any now-empty per-project session directories left behind
#
# Usage:
#   ~/.pi/scripts/archive-old-sessions.sh                 # archive sessions older than 90 days
#   ~/.pi/scripts/archive-old-sessions.sh --days 180       # custom threshold
#   ~/.pi/scripts/archive-old-sessions.sh --dry-run        # list what would be archived, change nothing
#
# Suggested cadence: monthly (per the plan). Not wired into cron/launchd by
# default -- run manually, or add your own scheduler entry pointing at this
# script once you're comfortable with what it does.

set -euo pipefail

SESSIONS_DIR="$HOME/.pi/agent/sessions"
ARCHIVE_DIR="$HOME/.pi/session-archives"
DAYS=90
DRY_RUN=0

while [[ $# -gt 0 ]]; do
	case "$1" in
	--days)
		DAYS="$2"
		shift 2
		;;
	--dry-run)
		DRY_RUN=1
		shift
		;;
	*)
		echo "Unknown argument: $1" >&2
		echo "Usage: $0 [--days N] [--dry-run]" >&2
		exit 2
		;;
	esac
done

if [[ ! -d "$SESSIONS_DIR" ]]; then
	echo "No sessions directory at $SESSIONS_DIR -- nothing to do." >&2
	exit 0
fi

# Note: uses a temp-file + while-read loop instead of `mapfile`, since macOS
# ships bash 3.2 by default (no /bin/bash mapfile builtin, no readarray).
OLD_FILES_LIST=$(mktemp)
trap 'rm -f "$OLD_FILES_LIST"' EXIT
find "$SESSIONS_DIR" -name "*.jsonl" -mtime "+$DAYS" -print >"$OLD_FILES_LIST"
OLD_FILES=()
while IFS= read -r line; do
	OLD_FILES+=("$line")
done <"$OLD_FILES_LIST"

if [[ ${#OLD_FILES[@]} -eq 0 ]]; then
	echo "No session files older than $DAYS days. Nothing to archive."
	exit 0
fi

TOTAL_SIZE=$(du -ch "${OLD_FILES[@]}" 2>/dev/null | tail -1 | cut -f1)
echo "Found ${#OLD_FILES[@]} session file(s) older than $DAYS days (total: $TOTAL_SIZE)."

if [[ $DRY_RUN -eq 1 ]]; then
	echo "--- dry run: would archive ---"
	printf '%s\n' "${OLD_FILES[@]}"
	exit 0
fi

mkdir -p "$ARCHIVE_DIR"
ARCHIVE_NAME="session-archive-$(date +%Y%m%d-%H%M%S).tgz"
ARCHIVE_PATH="$ARCHIVE_DIR/$ARCHIVE_NAME"

# Paths relative to $HOME/.pi so the tarball's internal structure matches
# agent/sessions/<project>/<file>.jsonl and can be extracted straight back
# into ~/.pi/ if ever needed.
(
	cd "$HOME/.pi"
	printf '%s\n' "${OLD_FILES[@]}" | sed "s|^$HOME/.pi/||" | tar -czf "$ARCHIVE_PATH" -T -
)

echo "Archived to: $ARCHIVE_PATH"

# Verify the archive is readable and contains the expected number of entries
# before deleting anything.
ARCHIVED_COUNT=$(tar -tzf "$ARCHIVE_PATH" | grep -c '\.jsonl$' || true)
if [[ "$ARCHIVED_COUNT" -ne "${#OLD_FILES[@]}" ]]; then
	echo "ERROR: archive contains $ARCHIVED_COUNT entries, expected ${#OLD_FILES[@]}. Not deleting originals." >&2
	exit 1
fi

echo "Verified archive contains all ${#OLD_FILES[@]} files. Removing originals..."
printf '%s\n' "${OLD_FILES[@]}" | xargs rm -f

# Clean up now-empty per-project session directories.
find "$SESSIONS_DIR" -mindepth 1 -maxdepth 1 -type d -empty -delete

echo "Done. $ARCHIVE_PATH ($TOTAL_SIZE) -- delete this file once you're sure you don't need it, or move it to cold storage."
