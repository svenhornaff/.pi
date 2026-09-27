#!/usr/bin/env python3
"""
session-usage-report.py

Reports model usage, cache read/write, and cost across pi session .jsonl
files (per ~/.pi/setup-refactor-plan.md, Phase 8, item 3).

Reads every source of billed usage in a session, matching the accounting in
agent/extensions/session-stats.ts (docs/p-mac-harness.html P2, "All-sessions
spend is undercounted" -- this script used to read assistant messages only):
  - assistant messages' `usage` block (input/output/cacheRead/cacheWrite/
    reasoning tokens + cost.*), bucketed by provider/model
  - toolResult messages with their own `usage` (nested LLM work performed BY
    a tool, e.g. pi-condense's summarizer calls), bucketed as (tool-internal)
  - toolResult messages from `advisor`/`architect`, which report usage under
    `details.<toolName>.usage` instead of `message.usage`, bucketed as
    `(advisor)`/`(architect)` -- only used when `message.usage` is absent, so
    a future version of either tool that sets `message.usage` directly is
    not double-counted
  - `compaction` entries, bucketed as (compaction)
  - `branch_summary` entries, bucketed as (branch-summary)

Also flags sessions with zero cacheRead despite non-trivial input tokens --
this is exactly the pattern that caused the ~€275 uncached LLMHub session
documented in ~/.pi/prompt-cache-analysis.md, so surfacing it here turns
that one-off manual analysis into a routine, repeatable check.

Usage:
    python3 ~/.pi/scripts/session-usage-report.py
    python3 ~/.pi/scripts/session-usage-report.py --sessions-dir ~/.pi/agent/sessions
    python3 ~/.pi/scripts/session-usage-report.py --include-archives
    python3 ~/.pi/scripts/session-usage-report.py --since 2026-08-01
    python3 ~/.pi/scripts/session-usage-report.py --json > report.json

Reads session logs, which may contain file contents, command output, and
model/tool results -- this script only extracts token/cost metadata, never
prints message content, but treat the underlying files as sensitive.
"""

import argparse
import json
import sys
import tarfile
from collections import defaultdict
from datetime import datetime
from pathlib import Path


def iter_jsonl_lines(path_or_fileobj):
    for line in path_or_fileobj:
        if isinstance(line, bytes):
            line = line.decode("utf-8", errors="replace")
        line = line.strip()
        if not line:
            continue
        try:
            yield json.loads(line)
        except json.JSONDecodeError:
            continue


def usage_entries(d):
    """Yield (provider, model, usage_dict) for every billable usage source on
    one session-log entry, mirroring session-stats.ts's computeSessionStats().
    """
    entry_type = d.get("type")

    if entry_type == "message":
        msg = d.get("message", {}) or {}
        role = msg.get("role")
        if role == "assistant" and msg.get("usage"):
            yield (msg.get("provider", "unknown"), msg.get("model", "unknown"), msg["usage"])
            return
        if role == "toolResult":
            tool_name = msg.get("toolName")
            usage = msg.get("usage")
            if not usage and tool_name in ("advisor", "architect"):
                details = (msg.get("details") or {}).get(tool_name) or {}
                tool_usage = details.get("usage")
                if tool_usage:
                    yield (f"({tool_name})", details.get("model", "unknown"), tool_usage)
                return
            if usage:
                yield ("(tool-internal)", tool_name or "unknown", usage)
                return
        return

    if entry_type == "compaction" and d.get("usage"):
        yield ("(compaction)", "summary", d["usage"])
        return

    if entry_type == "branch_summary" and d.get("usage"):
        yield ("(branch-summary)", "summary", d["usage"])
        return


def process_session(lines, session_id, stats, since_dt):
    session_input = 0
    session_cache_read = 0
    session_cost = 0.0
    session_provider_model = None
    session_ts = None

    for d in lines:
        for provider, model, usage in usage_entries(d):
            ts = d.get("timestamp") or (d.get("message") or {}).get("timestamp")
            if ts:
                try:
                    ts_dt = datetime.fromisoformat(str(ts).replace("Z", "+00:00"))
                    if since_dt and ts_dt < since_dt:
                        continue
                    session_ts = ts_dt if session_ts is None else max(session_ts, ts_dt)
                except (ValueError, TypeError):
                    pass

            key = (provider, model)
            session_provider_model = key

            cost = usage.get("cost", {}) or {}
            total_cost = cost.get("total", 0) or 0

            s = stats[key]
            s["input"] += usage.get("input", 0) or 0
            s["output"] += usage.get("output", 0) or 0
            s["cacheRead"] += usage.get("cacheRead", 0) or 0
            s["cacheWrite"] += usage.get("cacheWrite", 0) or 0
            s["reasoning"] += usage.get("reasoning", 0) or 0
            s["cost"] += total_cost
            s["turns"] += 1

            # Only real provider input counts toward the zero-cache-read flag --
            # (advisor)/(architect)/(tool-internal)/(compaction)/(branch-summary)
            # rows are a different call shape and would create false positives.
            if provider not in ("(advisor)", "(architect)", "(tool-internal)", "(compaction)", "(branch-summary)"):
                session_input += usage.get("input", 0) or 0
                session_cache_read += usage.get("cacheRead", 0) or 0
            session_cost += total_cost

    return {
        "session_id": session_id,
        "provider_model": session_provider_model,
        "input": session_input,
        "cacheRead": session_cache_read,
        "cost": session_cost,
        "timestamp": session_ts.isoformat() if session_ts else None,
    }


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--sessions-dir", default=str(Path.home() / ".pi/agent/sessions"))
    ap.add_argument("--archives-dir", default=str(Path.home() / ".pi/session-archives"))
    ap.add_argument("--include-archives", action="store_true", help="Also scan .tgz archives from archive-old-sessions.sh")
    ap.add_argument("--since", default=None, help="Only count usage from turns at/after this ISO date, e.g. 2026-08-01")
    ap.add_argument("--zero-cache-threshold", type=int, default=50_000,
                     help="Flag sessions with >= this many input tokens but zero cacheRead (default: 50000)")
    ap.add_argument("--json", action="store_true", help="Output machine-readable JSON instead of a table")
    args = ap.parse_args()

    since_dt = None
    if args.since:
        since_dt = datetime.fromisoformat(args.since).replace(tzinfo=None)

    stats = defaultdict(lambda: {"input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0, "reasoning": 0, "cost": 0.0, "turns": 0})
    session_summaries = []

    sessions_dir = Path(args.sessions_dir)
    if sessions_dir.is_dir():
        for jsonl_path in sessions_dir.rglob("*.jsonl"):
            try:
                with open(jsonl_path, encoding="utf-8", errors="replace") as f:
                    summary = process_session(iter_jsonl_lines(f), str(jsonl_path), stats, since_dt)
            except OSError as e:
                print(f"warning: skipping {jsonl_path}: {e}", file=sys.stderr)
                continue
            session_summaries.append(summary)

    if args.include_archives:
        archives_dir = Path(args.archives_dir)
        if archives_dir.is_dir():
            for tgz_path in archives_dir.glob("*.tgz"):
                with tarfile.open(tgz_path, "r:gz") as tf:
                    for member in tf.getmembers():
                        if not member.name.endswith(".jsonl"):
                            continue
                        f = tf.extractfile(member)
                        if f is None:
                            continue
                        summary = process_session(iter_jsonl_lines(f), f"{tgz_path.name}:{member.name}", stats, since_dt)
                        session_summaries.append(summary)

    zero_cache_sessions = [
        s for s in session_summaries
        if s["input"] >= args.zero_cache_threshold and s["cacheRead"] == 0
    ]

    if args.json:
        out = {
            "by_model": {f"{p}/{m}": v for (p, m), v in stats.items()},
            "zero_cache_flagged_sessions": zero_cache_sessions,
            "session_count": len(session_summaries),
        }
        print(json.dumps(out, indent=2, default=str))
        return

    if not stats:
        print("No usage data found.")
        return

    print(f"=== Usage by provider/model ({'since ' + args.since if args.since else 'all time'}) ===\n")
    header = f"{'provider/model':<45} {'turns':>6} {'input':>10} {'output':>10} {'cacheRead':>10} {'cacheWrite':>10} {'cost (EUR/USD)':>15}"
    print(header)
    print("-" * len(header))
    total_cost = 0.0
    for (provider, model), v in sorted(stats.items(), key=lambda kv: -kv[1]["cost"]):
        label = f"{provider}/{model}"
        print(f"{label:<45} {v['turns']:>6} {v['input']:>10} {v['output']:>10} {v['cacheRead']:>10} {v['cacheWrite']:>10} {v['cost']:>15.4f}")
        total_cost += v["cost"]
    print("-" * len(header))
    print(f"{'TOTAL':<45} {'':>6} {'':>10} {'':>10} {'':>10} {'':>10} {total_cost:>15.4f}")

    print(f"\nSessions scanned: {len(session_summaries)}")

    if zero_cache_sessions:
        print(f"\n⚠️  {len(zero_cache_sessions)} session(s) with >= {args.zero_cache_threshold:,} input tokens "
              f"but ZERO cacheRead -- likely missing compat.cacheControlFormat or a provider that "
              f"doesn't support caching. This is the exact pattern behind the ~€275 uncached LLMHub "
              f"session in ~/.pi/prompt-cache-analysis.md:")
        for s in sorted(zero_cache_sessions, key=lambda s: -s["input"])[:10]:
            pm = f"{s['provider_model'][0]}/{s['provider_model'][1]}" if s["provider_model"] else "unknown"
            print(f"  - {pm:<40} input={s['input']:>10}  cost={s['cost']:.4f}  {Path(s['session_id']).name}")
    else:
        print("\n✅ No sessions flagged for zero-cache-with-high-input-tokens.")


if __name__ == "__main__":
    main()
