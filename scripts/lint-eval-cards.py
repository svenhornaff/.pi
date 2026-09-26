#!/usr/bin/env python3
"""
Static lint for docs/eval/tasks/*.md task cards (docs/subagent-eval.md
§3.4/§3.5 answer-key hygiene).

Rule (review-class cards only): the card must not describe the seeded
defect itself. Concretely:

  - `class: review` cards must reference an answer key (a path under
    `pi-eval/answers/`) somewhere in the card.
  - `class: review` cards' "## Done means" section must not contain a
    backticked file:line reference, file path, function call, or
    dotted Class.method identifier — those are exactly the answer-key
    leakage this rule exists to catch (heuristic, not exhaustive; a human
    still has to read the card before seeding a defect).

`status: smoke` cards still get checked and reported (so a known-bad card
like a retired R01 stays visible), but their failures do not fail the
overall exit code — a smoke card is explicitly excluded from every gate
(docs/subagent-eval.md §11) and re-litigating it on every lint run would
just be noise. Non-smoke review cards that fail this lint DO fail the
overall exit code.

Exit code: 0 if every non-smoke card passes, 1 otherwise. Smoke-card
failures are printed as WARN and never affect the exit code.
"""

import re
import sys
from pathlib import Path

TASKS_DIR = Path(__file__).resolve().parent.parent / "docs" / "eval" / "tasks"

ANSWER_KEY_RE = re.compile(r"pi-eval/answers/")
BACKTICK_RE = re.compile(r"`([^`]+)`")

# Heuristics for "this backticked span looks like it's naming a location or
# a symbol, not just a generic term":
LOOKS_LIKE_FILE_LINE = re.compile(r":\d+")          # foo.js:123
LOOKS_LIKE_PATH = re.compile(r"[\w-]+/[\w./-]+\.\w+")  # src/click/types.py
LOOKS_LIKE_CALL = re.compile(r"\w+\(\)")            # convert()
LOOKS_LIKE_DOTTED_SYMBOL = re.compile(r"\b[A-Z]\w*\.\w+\b")  # Command._callParseArg


def parse_frontmatter(content: str) -> dict:
    if not content.startswith("---"):
        return {}
    end = content.find("\n---", 3)
    if end == -1:
        return {}
    block = content[3:end]
    result: dict = {}
    for line in block.splitlines():
        line = line.strip()
        if not line or line.startswith("#") or ":" not in line:
            continue
        key, _, value = line.partition(":")
        result[key.strip()] = value.strip().strip("\"'")
    return result


def extract_section(content: str, heading: str) -> str:
    """Return the body text of a '## <heading>' section, up to the next
    '## ' heading or end of file."""
    pattern = re.compile(
        rf"^##\s+{re.escape(heading)}.*?\n(.*?)(?=^##\s|\Z)",
        re.MULTILINE | re.DOTALL,
    )
    m = pattern.search(content)
    return m.group(1) if m else ""


def leaky_spans(text: str) -> list[str]:
    leaks = []
    for span in BACKTICK_RE.findall(text):
        if (
            LOOKS_LIKE_FILE_LINE.search(span)
            or LOOKS_LIKE_PATH.search(span)
            or LOOKS_LIKE_CALL.search(span)
            or LOOKS_LIKE_DOTTED_SYMBOL.search(span)
        ):
            leaks.append(span)
    return leaks


def lint_file(path: Path) -> list[str]:
    content = path.read_text()
    fm = parse_frontmatter(content)
    errors: list[str] = []

    if fm.get("class") != "review":
        return errors  # only review-class cards carry this risk

    if not ANSWER_KEY_RE.search(content):
        errors.append("class: review but no 'pi-eval/answers/' reference found anywhere in the card")

    done_means = extract_section(content, "Done means")
    leaks = leaky_spans(done_means)
    if leaks:
        errors.append(
            "class: review card's 'Done means' section contains backticked "
            f"file:line/path/function/symbol references (answer-key leakage): {leaks}"
        )

    return errors


def main() -> int:
    if not TASKS_DIR.exists():
        print(f"No {TASKS_DIR} directory — nothing to lint.")
        return 0

    hard_failed = 0
    checked = 0
    for path in sorted(TASKS_DIR.glob("*.md")):
        checked += 1
        errors = lint_file(path)
        fm = parse_frontmatter(path.read_text())
        is_smoke = fm.get("status") == "smoke"

        if not errors:
            print(f"ok   {path.name}")
            continue

        label = "WARN" if is_smoke else "FAIL"
        print(f"{label} {path.name}:", file=sys.stderr)
        for e in errors:
            print(f"  - {e}", file=sys.stderr)
        if is_smoke:
            print("  (status: smoke — excluded from gates, not counted against exit code)", file=sys.stderr)
        else:
            hard_failed += 1

    print(f"\n{checked - hard_failed}/{checked} eval task cards passed lint (smoke-card warnings excluded from this count's denominator's failure side)")
    return 1 if hard_failed else 0


if __name__ == "__main__":
    sys.exit(main())
