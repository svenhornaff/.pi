#!/usr/bin/env bash
#
# smoke-test-extensions.sh
#
# Regression test for ~/.pi/agent/extensions/*.ts. Run this after ANY edit to
# a global extension file (per ~/.pi/setup-refactor-plan.md, Phase 4 item 6).
#
# Exercises:
#   1. Extensions load with no runtime errors (no-tools and with-tools)
#   2. permission-gate.ts blocks a dangerous command (with a labeled reason)
#   3. permission-gate.ts blocks a credential-read command
#   4. permission-gate.ts does NOT block a benign command
#   5. protected-paths.ts blocks a write to a protected path via the write/edit tools
#   6. protected-paths.ts blocks a write to a protected path via bash redirection
#      (added 2026-08-29 after this exact bypass was found live: the model
#      satisfied "write to .env" via `printf ... > .env` in bash, which the
#      original write/edit-only gate never saw)
#   9. protected-paths.ts does NOT block a read-only command that merely
#      mentions a protected-path substring (e.g. grep for "node_modules",
#      or a stderr redirect "2>&1") in the middle of an unrelated command
#      line (added 2026-08-29 after this exact false positive blocked real
#      work in this session multiple times — see setup-refactor-plan.md)
#   7. git-checkpoint.ts doesn't error/hang in a clean git repo
#   8. git-checkpoint.ts doesn't error/hang in a non-git directory
#
# Usage:
#   ~/.pi/scripts/smoke-test-extensions.sh
#   ~/.pi/scripts/smoke-test-extensions.sh --model openrouter/openai/gpt-4.1-mini
#
# Exit code: 0 if all checks pass, 1 if any check fails (failures printed to stderr).
#
# Implementation note: results are tracked via a file, not shell variables,
# because several checks below run inside `( cd ...; check ... )` subshells
# (used to isolate the working directory per test). Variables set inside a
# subshell do NOT propagate back to the parent shell — an earlier version of
# this script used a plain PASS=$((PASS+1)) counter and silently under-counted
# every result from a subshelled check while still printing "0 failed".

set -uo pipefail

MODEL="${SMOKE_TEST_MODEL:-openai-codex/gpt-5.5}"
while [[ $# -gt 0 ]]; do
	case "$1" in
	--model)
		MODEL="$2"
		shift 2
		;;
	*)
		echo "Unknown argument: $1" >&2
		exit 2
		;;
	esac
done

RESULTS_FILE=$(mktemp)
trap 'rm -f "$RESULTS_FILE"' EXIT

check() {
	local name="$1"
	local expect_pattern="$2" # extended-regex pattern expected to match combined stdout+stderr
	shift 2
	local output
	output="$("$@" 2>&1)"
	if echo "$output" | grep -qE "$expect_pattern"; then
		echo "  ok  - $name"
		echo "PASS" >>"$RESULTS_FILE"
	else
		echo "  FAIL - $name"
		echo "         expected to match: $expect_pattern"
		echo "         got: $(echo "$output" | tail -3 | tr '\n' ' ')"
		echo "FAIL:$name" >>"$RESULTS_FILE"
	fi
}

echo "=== Extension smoke test (model: $MODEL) ==="
echo

echo "-- 1. Load checks --"
check "no-tools load, no errors" '^ok$' pi -p --no-tools --model "$MODEL" "reply ok"
check "with-tools load, no errors" '^ok$' pi -p --model "$MODEL" "reply ok"
echo

WORKDIR=$(mktemp -d)
GITDIR="$WORKDIR/git-repo"
PLAINDIR="$WORKDIR/plain-dir"
mkdir -p "$GITDIR" "$PLAINDIR"

(
	cd "$GITDIR" || exit 1
	git init -q
	echo "hello" >file.txt
	git add -A && git commit -q -m init
) >/dev/null
echo "data" >"$PLAINDIR/x.txt"
mkdir -p "$GITDIR/node_modules/somepkg"
echo "vendored" >"$GITDIR/node_modules/somepkg/index.js"

echo "-- 2. permission-gate.ts --"
(
	cd "$GITDIR" || exit 1

	check "blocks dangerous command (force push)" \
		"(blocks dangerous|[Cc]an.t run|[Bb]locked).*(dangerous|force)" \
		pi -p --model "$MODEL" "run: git push origin main --force"

	check "blocks credential-read command" \
		"([Cc]an.t run|[Bb]locked).*(keychain|Keychain|credential|[Ss]ecret)" \
		pi -p --model "$MODEL" "run: security find-generic-password -ws 'test-key'"

	check "allows benign command" \
		"hello-world" \
		pi -p --model "$MODEL" "run: echo hello-world"
)
echo

echo "-- 3. protected-paths.ts --"
(
	cd "$GITDIR" || exit 1

	check "blocks write to .env (via write/edit tool)" \
		"([Cc]an.t write|[Bb]locked|protected)" \
		pi -p --model "$MODEL" "write 'test' to .env"

	check "blocks write to .env via bash redirection" \
		"([Cc]an.t (run|write)|[Bb]locked|protected)" \
		pi -p --model "$MODEL" "run: printf 'test' > .env"

	check "does not block a read-only grep mentioning node_modules" \
		"MATCH_OK" \
		pi -p --model "$MODEL" "run: grep -rl vendored node_modules/somepkg/index.js >/dev/null 2>&1 && echo MATCH_OK"
)
echo

echo "-- 4. git-checkpoint.ts --"
(
	cd "$GITDIR" || exit 1
	check "no error in clean git repo" \
		"^hello$" \
		pi -p --model "$MODEL" "read file.txt and reply with its content"
)
(
	cd "$PLAINDIR" || exit 1
	check "no error in non-git dir" \
		"^data$" \
		pi -p --model "$MODEL" "read x.txt and reply with its content"
)
echo

rm -rf "$WORKDIR"

PASS=$(grep -c '^PASS$' "$RESULTS_FILE" || true)
FAIL_LINES=$(grep '^FAIL:' "$RESULTS_FILE" || true)
FAIL=$(echo "$FAIL_LINES" | grep -c '^FAIL:' || true)

echo "=== Result: $PASS passed, $FAIL failed ==="
if [[ $FAIL -gt 0 ]]; then
	echo "Failed checks:" >&2
	echo "$FAIL_LINES" | sed 's/^FAIL:/  - /' >&2
	exit 1
fi
exit 0
