#!/usr/bin/env bash
# eval-worktree.sh <repo> <TASK-ID> <VARIANT> [--diff]
#
# Creates a clean git worktree for one evaluation run and prints the pi
# command for the requested variant. See docs/subagent-eval.md §5.1, §12.
#
# <repo>      one of the directory names under ~/pi-eval/repos/ (click, commander, doc-manager)
# <TASK-ID>   task card id, e.g. E01, F02, R01 — must match docs/eval/tasks/<ID>.md
# <VARIANT>   V0 | V0r | V1 | V2 | V3 | V4 | V5   (see docs/subagent-eval.md §4)
# --diff      use the base <repo>'s eval/<ID>-diff branch instead of eval/base
#             (review tasks, §3.5)
#
# Worktrees are created under /tmp/eval-<TASK-ID>-<VARIANT> and must be
# removed after the run with:
#   git -C ~/pi-eval/repos/<repo> worktree remove /tmp/eval-<TASK-ID>-<VARIANT>

set -euo pipefail

PI_EVAL_HOME="${PI_EVAL_HOME:-$HOME/pi-eval}"
PI_HOME="${PI_HOME:-$HOME/.pi}"

usage() {
	echo "Usage: $0 <repo> <TASK-ID> <VARIANT> [--diff]" >&2
	echo "  repo:    one of: $(ls "$PI_EVAL_HOME/repos" 2>/dev/null | tr '\n' ' ')" >&2
	echo "  variant: V0 | V0r | V1 | V2 | V3 | V4 | V5" >&2
	exit 1
}

[[ $# -lt 3 ]] && usage

REPO="$1"
TASK_ID="$2"
VARIANT="$3"
USE_DIFF="${4:-}"

REPO_PATH="$PI_EVAL_HOME/repos/$REPO"
[[ -d "$REPO_PATH" ]] || { echo "error: no repo at $REPO_PATH" >&2; exit 1; }

TASK_CARD="$PI_HOME/docs/eval/tasks/${TASK_ID}.md"
[[ -f "$TASK_CARD" ]] || { echo "error: no task card at $TASK_CARD" >&2; exit 1; }

if [[ "$USE_DIFF" == "--diff" ]]; then
	BASE_REF="eval/${TASK_ID}-diff"
else
	BASE_REF="eval/base"
fi

git -C "$REPO_PATH" rev-parse --verify "$BASE_REF" >/dev/null 2>&1 || {
	echo "error: ref $BASE_REF does not exist in $REPO_PATH" >&2
	exit 1
}

WORKTREE="/tmp/eval-${TASK_ID}-${VARIANT}"
if [[ -d "$WORKTREE" ]]; then
	echo "error: $WORKTREE already exists — remove it first:" >&2
	echo "  git -C $REPO_PATH worktree remove $WORKTREE" >&2
	exit 1
fi

git -C "$REPO_PATH" worktree add --quiet --detach "$WORKTREE" "$BASE_REF"
echo "worktree created: $WORKTREE (from $BASE_REF)"

HINT=""
case "$VARIANT" in
V0)
	CMD="pi --exclude-tools subagent --name \"eval ${TASK_ID} ${VARIANT}\""
	;;
V0r)
	CMD="pi --exclude-tools subagent --name \"eval ${TASK_ID} ${VARIANT}\"  # then run /review-fresh"
	;;
V1)
	# Subagent runtime is available; you invoke the explorer agent explicitly
	# from inside the session (§4). --tools is a tool allowlist, not an agent
	# selector — it must not be used to pick an agent.
	CMD="pi --name \"eval ${TASK_ID} ${VARIANT}\""
	HINT="agent(s) allowed this variant: explorer only — invoke it explicitly (e.g. via the subagent tool); do not invoke reviewer/architect/etc."
	;;
V2)
	# Same runtime as V1, plus reviewer is also an allowed agent (§4).
	CMD="pi --name \"eval ${TASK_ID} ${VARIANT}\""
	HINT="agent(s) allowed this variant: explorer and reviewer — invoke explicitly; do not invoke architect/verifier/security/researcher."
	;;
V3)
	CMD="pi --name \"eval ${TASK_ID} ${VARIANT}\"  # then run /design"
	;;
V4)
	CMD="pi --name \"eval ${TASK_ID} ${VARIANT}\"  # then run /design then /ship-check"
	;;
V5)
	CMD="pi --name \"eval ${TASK_ID} ${VARIANT}\"  # then run /design then /ship-check (security/researcher auto-trigger)"
	;;
*)
	echo "error: unknown variant $VARIANT" >&2
	exit 1
	;;
esac

ENV_PREFIX=""
if [[ "$REPO" == "doc-manager" ]]; then
	ENV_PREFIX="LLMHUB_API_KEY=eval-dummy-not-a-real-key TAVILY_API_KEY=eval-dummy-not-a-real-key "
	echo "note: doc-manager's test suite needs LLMHUB_API_KEY/TAVILY_API_KEY set (dummy values injected below) — see docs/eval/README.md"
fi

echo
if [[ -n "$HINT" ]]; then
	echo "hint: $HINT"
fi
echo "pi command for variant $VARIANT (run with cwd=$WORKTREE):"
echo "  cd $WORKTREE && ${ENV_PREFIX}${CMD}"
echo
echo "task text is at: $TASK_CARD"
echo "after the run, extract metrics with:"
echo "  python3 $PI_HOME/scripts/eval-metrics.py --since <start-time> --cwd-contains eval-${TASK_ID}-${VARIANT}"
echo "then remove the worktree with:"
echo "  git -C $REPO_PATH worktree remove $WORKTREE"
