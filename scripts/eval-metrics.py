#!/usr/bin/env python3
"""
eval-metrics.py

Extract §6.1 automatic metrics (docs/subagent-eval.md) for one evaluation
run from pi session .jsonl files: cost_main, cost_child, peak_ctx, turns,
compactions, minutes.

Must be validated once against /session-stats before being trusted (§6.1):
run a real session, note /session-stats' reported cost for it, then run
this script against the same session and confirm cost_main matches.

Usage:
    python3 ~/.pi/scripts/eval-metrics.py --since <ISO-or-epoch> --cwd-contains eval-<ID>-<VARIANT>
    python3 ~/.pi/scripts/eval-metrics.py --session-file <path-to.jsonl>
    python3 ~/.pi/scripts/eval-metrics.py --since ... --cwd-contains ... --json

Reads session logs, which may contain file contents and command output --
this script only extracts token/cost/timing metadata, never prints message
content. Treat the underlying files as sensitive regardless.
"""

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path


def parse_ts(ts):
    if not ts:
        return None
    try:
        return datetime.fromisoformat(str(ts).replace("Z", "+00:00"))
    except (ValueError, TypeError):
        return None


def iter_jsonl(path):
    try:
        with open(path, encoding="utf-8", errors="replace") as f:
            lines = f.readlines()
    except OSError as exc:
        print(f"warning: could not open {path}: {exc}", file=sys.stderr)
        return
    for line in lines:
        line = line.strip()
        if not line:
            continue
        try:
            yield json.loads(line)
        except json.JSONDecodeError:
            continue


def find_session_files(sessions_dir, cwd_contains):
    """Session dirs are named from a sanitized cwd. Match on dirname OR the
    `cwd` field of the session's first line, since sanitization is lossy."""
    matches = []
    for jsonl_path in Path(sessions_dir).rglob("*.jsonl"):
        if cwd_contains and cwd_contains not in str(jsonl_path.parent.name):
            # fall back to checking the recorded cwd field before rejecting
            try:
                first = next(iter_jsonl(jsonl_path), None)
            except (OSError, StopIteration):
                first = None
            cwd_field = (first or {}).get("cwd", "")
            if cwd_contains not in cwd_field:
                continue
        matches.append(jsonl_path)
    return matches


def session_metrics(path, since_dt, until_dt):
    turns = 0
    compactions = 0
    cost_total = 0.0
    peak_ctx = 0
    first_ts = None
    last_ts = None

    for d in iter_jsonl(path):
        ts = parse_ts(d.get("timestamp"))
        if ts:
            if since_dt and ts < since_dt:
                continue
            if until_dt and ts > until_dt:
                continue
            first_ts = ts if first_ts is None else min(first_ts, ts)
            last_ts = ts if last_ts is None else max(last_ts, ts)

        # Real session-level compaction entries are `type: "compaction"`
        # (see session-manager.js `appendCompaction`). `type: "custom"` entries
        # with `customType` starting "context-prune-" are a *different*,
        # unrelated feature (pi-lens tool-call-output pruning/summarization,
        # this repo's `contextPrune`/pi-condense settings notwithstanding the
        # confusingly similar name) and must NOT be counted here — verified
        # against pi's own session-manager.js source, not assumed.
        if d.get("type") == "compaction":
            compactions += 1
            continue

        msg = d.get("message", {})
        if msg.get("role") != "assistant":
            continue
        usage = msg.get("usage")
        if not usage:
            continue

        turns += 1
        cost = usage.get("cost", {}) or {}
        cost_total += cost.get("total", 0) or 0

        prompt_size = (
            (usage.get("input", 0) or 0)
            + (usage.get("cacheRead", 0) or 0)
            + (usage.get("cacheWrite", 0) or 0)
        )
        peak_ctx = max(peak_ctx, prompt_size)

    minutes = None
    if first_ts and last_ts:
        minutes = round((last_ts - first_ts).total_seconds() / 60, 1)

    return {
        "path": str(path),
        "turns": turns,
        "compactions": compactions,
        "cost": round(cost_total, 6),
        "peak_ctx": peak_ctx,
        "first_ts": first_ts.isoformat() if first_ts else None,
        "last_ts": last_ts.isoformat() if last_ts else None,
        "minutes": minutes,
    }


def child_cost(subagents_dir, since_dt, until_dt):
    """Best-effort: sum cost of every child session in the time window.
    Correlation to a specific parent run is by time window only — fine for
    Phase 0 (V0/V0r never spawn subagents, so this should read 0), but not
    precise once V1+ variants run multiple evals concurrently. See S5/S6
    (docs/subagent-eval.md §12) for the exact-once-counting smoke check."""
    total = 0.0
    n = 0
    for jsonl_path in Path(subagents_dir).glob("*.jsonl"):
        m = session_metrics(jsonl_path, since_dt, until_dt)
        if m["turns"] > 0:
            total += m["cost"]
            n += 1
    return round(total, 6), n


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--sessions-dir", default=str(Path.home() / ".pi/agent/sessions"))
    ap.add_argument("--since", help="Only count events at/after this ISO timestamp")
    ap.add_argument("--until", help="Only count events at/before this ISO timestamp (default: now)")
    ap.add_argument("--cwd-contains", help="Match session dirs/cwd containing this substring, e.g. eval-F02-V0")
    ap.add_argument("--session-file", help="Analyze one specific .jsonl file directly instead of searching")
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args()

    since_dt = parse_ts(args.since) if args.since else None
    until_dt = parse_ts(args.until) if args.until else datetime.now(timezone.utc)

    if args.session_file:
        session_files = [Path(args.session_file)]
    else:
        if not args.cwd_contains:
            print("error: --cwd-contains or --session-file is required", file=sys.stderr)
            sys.exit(1)
        session_files = find_session_files(args.sessions_dir, args.cwd_contains)

    if not session_files:
        print(f"no matching session files found under {args.sessions_dir}", file=sys.stderr)
        sys.exit(1)

    main_metrics = [session_metrics(p, since_dt, until_dt) for p in session_files]
    main_metrics = [m for m in main_metrics if m["turns"] > 0 or m["compactions"] > 0]

    cost_main = round(sum(m["cost"] for m in main_metrics), 6)
    turns = sum(m["turns"] for m in main_metrics)
    compactions = sum(m["compactions"] for m in main_metrics)
    peak_ctx = max((m["peak_ctx"] for m in main_metrics), default=0)

    firsts = [dt for m in main_metrics if (dt := parse_ts(m["first_ts"])) is not None]
    lasts = [dt for m in main_metrics if (dt := parse_ts(m["last_ts"])) is not None]
    minutes = None
    if firsts and lasts:
        earliest = min(firsts)
        latest = max(lasts)
        minutes = round((latest - earliest).total_seconds() / 60, 1)

    subagents_dir = Path(args.sessions_dir) / "subagents"
    cost_child, n_children = (0.0, 0)
    if subagents_dir.is_dir():
        cost_child, n_children = child_cost(subagents_dir, since_dt, until_dt)

    result = {
        "session_files": [m["path"] for m in main_metrics],
        "cost_main": cost_main,
        "cost_child": cost_child,
        "cost_total": round(cost_main + cost_child, 6),
        "n_child_sessions": n_children,
        "peak_ctx": peak_ctx,
        "turns": turns,
        "compactions": compactions,
        "minutes": minutes,
    }

    if args.json:
        print(json.dumps(result, indent=2))
    else:
        print(f"session file(s): {len(main_metrics)}")
        for p in result["session_files"]:
            print(f"  {p}")
        print(f"cost_main:   {result['cost_main']}")
        print(f"cost_child:  {result['cost_child']} ({result['n_child_sessions']} child session(s))")
        print(f"cost_total:  {result['cost_total']}")
        print(f"peak_ctx:    {result['peak_ctx']}")
        print(f"turns:       {result['turns']}")
        print(f"compactions: {result['compactions']}")
        print(f"minutes:     {result['minutes']}")


if __name__ == "__main__":
    main()
