#!/usr/bin/env python3
"""
architect-call-check.py <session.jsonl>

Helper for scripts/smoke-test-extensions.sh A3b: inspect one session .jsonl
and report whether the `architect` tool was called, and whether that call
made a real model call (i.e. whether details.architect.usage is present).

Prints one of:
    CALL_FOUND NO_USAGE     -- architect ran, refused at the cap, no spend
    CALL_FOUND USAGE_FOUND  -- architect ran and made a real model call
    NO_CALL NO_USAGE        -- architect was never called in this session
"""

import json
import sys


def main():
    if len(sys.argv) != 2:
        print("usage: architect-call-check.py <session.jsonl>", file=sys.stderr)
        sys.exit(2)

    found_call = False
    found_usage = False

    try:
        with open(sys.argv[1], encoding="utf-8", errors="replace") as f:
            lines = f.readlines()
    except OSError as e:
        print(f"error: cannot read {sys.argv[1]}: {e}", file=sys.stderr)
        sys.exit(1)

    for line in lines:
        line = line.strip()
        if not line:
            continue
        try:
            e = json.loads(line)
        except json.JSONDecodeError:
            continue
        if e.get("type") != "message":
            continue
        msg = e.get("message", {}) or {}
        if msg.get("role") != "toolResult" or msg.get("toolName") != "architect":
            continue
        found_call = True
        details = (msg.get("details") or {}).get("architect") or {}
        if details.get("usage"):
            found_usage = True

    print(f"{'CALL_FOUND' if found_call else 'NO_CALL'} {'USAGE_FOUND' if found_usage else 'NO_USAGE'}")


if __name__ == "__main__":
    main()
