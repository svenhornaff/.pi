#!/usr/bin/env python3
"""
Static lint for agent/agents/*.md frontmatter (subagent_concept.md §8.2).

Checks, per file:
  - has name, description, tools
  - name matches filename (minus .md)
  - does not grant edit, write, advisor, or subagent
  - does not grant bash unless the agent is named "verifier"
  - model is in agent/settings.json's enabledModels, and is not llmhub/* or
    ollama/* (ADR-10) unless explicitly justified in setup-refactor-plan.md
  - reviewer/security do not use an anthropic model family (ADR-9)
  - extensions: paths exist on disk

Exit code 0 = all agents pass, 1 = at least one violation (printed to stderr).
"""

import re
import sys
from pathlib import Path

AGENT_DIR = Path(__file__).resolve().parent.parent / "agent"
AGENTS_DIR = AGENT_DIR / "agents"
SETTINGS_PATH = AGENT_DIR / "settings.json"
DECISION_LOG_PATH = Path(__file__).resolve().parent.parent / "setup-refactor-plan.md"

FORBIDDEN_TOOLS = {"edit", "write", "advisor", "subagent"}
BASH_ALLOWED_AGENTS = {"verifier"}
NON_ANTHROPIC_REQUIRED = {"reviewer", "security"}
# Agents intentionally exempt from most policy checks (smoke-test-only, not
# a real persona). subagent_concept.md Phase 1 D3/D8 note _probe is
# test-only and removed at the end of Phase 2 -- it still must declare
# tools, but is not held to the model-tier/family rules meant for real
# personas doing real delegated work.
TEST_ONLY_AGENTS = {"_probe"}


def parse_frontmatter(content: str) -> dict:
    """Minimal frontmatter parser: good enough for this repo's flat
    key: value / key: [a, b] / key: a, b agent files. Not a full YAML
    parser -- if an agent file needs real YAML nesting, this should be
    swapped for a proper parser rather than extended ad hoc."""
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
        key = key.strip()
        value = value.strip()
        if value.startswith("[") and value.endswith("]"):
            items = [v.strip().strip("\"'") for v in value[1:-1].split(",")]
            result[key] = [v for v in items if v]
        elif "," in value and key in ("tools", "extensions"):
            result[key] = [v.strip() for v in value.split(",") if v.strip()]
        else:
            result[key] = value.strip("\"'")
    return result


def load_enabled_models() -> set[str]:
    import json

    if not SETTINGS_PATH.exists():
        return set()
    try:
        data = json.loads(SETTINGS_PATH.read_text())
    except (OSError, json.JSONDecodeError) as e:
        print(f"warning: could not read/parse {SETTINGS_PATH}: {e}", file=sys.stderr)
        return set()
    return set(data.get("enabledModels", []))


def load_justified_models() -> set[str]:
    """Models explicitly justified for agent use in the decision log
    despite matching llmhub/* or ollama/* (ADR-10 escape hatch)."""
    if not DECISION_LOG_PATH.exists():
        return set()
    text = DECISION_LOG_PATH.read_text()
    # Look for lines like: "ADR-10 exception: ollama/qwen3:8b for <agent> because ..."
    return set(re.findall(r"ADR-10 exception:\s*([\w./-]+)", text))


def lint_file(path: Path, enabled_models: set[str], justified_models: set[str]) -> list[str]:
    errors: list[str] = []
    content = path.read_text()
    fm = parse_frontmatter(content)
    stem = path.stem

    name = fm.get("name")
    description = fm.get("description")
    tools = fm.get("tools")
    model = fm.get("model")
    extensions = fm.get("extensions") or []

    if not name:
        errors.append("missing 'name'")
    if not description:
        errors.append("missing 'description'")
    if not tools:
        errors.append('missing or empty "tools:" (D3: never defaulted, must be explicit)')

    if name and name != stem:
        errors.append(f"name '{name}' does not match filename '{stem}.md'")

    tool_list = tools if isinstance(tools, list) else ([t.strip() for t in tools.split(",")] if tools else [])
    granted_forbidden = FORBIDDEN_TOOLS & set(tool_list)
    if granted_forbidden:
        errors.append(f"grants forbidden tool(s): {sorted(granted_forbidden)} (ADR-3/ADR-4)")

    # _probe is a documented, narrow exception (subagent_concept.md Phase 1
    # deliverables: "agent/agents/_probe.md (tools: read, bash; cheap
    # model), used only by the smoke test and deleted at the end of Phase
    # 2"). It is not a real persona and is not held to ADR-3 for that one
    # reason -- this does NOT relax ADR-3 for any other agent.
    if "bash" in tool_list and stem not in BASH_ALLOWED_AGENTS and stem not in TEST_ONLY_AGENTS:
        errors.append(f"grants 'bash' but only {sorted(BASH_ALLOWED_AGENTS)} (or {sorted(TEST_ONLY_AGENTS)}, smoke-test-only) may have it (ADR-3)")

    if stem not in TEST_ONLY_AGENTS and model:
        model_base = model.split(":", 1)[0]  # strip :thinking suffix
        if enabled_models and model_base not in enabled_models:
            errors.append(f"model '{model_base}' is not in settings.json enabledModels")
        is_llmhub_or_ollama = model_base.startswith(("llmhub/", "ollama/"))
        if is_llmhub_or_ollama and model_base not in justified_models:
            errors.append(
                f"model '{model_base}' matches llmhub/* or ollama/* (ADR-10) with no "
                f"'ADR-10 exception: {model_base}' line in setup-refactor-plan.md"
            )
        if stem in NON_ANTHROPIC_REQUIRED and model_base.startswith(("anthropic/", "openrouter/anthropic/")):
            errors.append(f"'{stem}' must not use an anthropic model family (ADR-9), got '{model_base}'")

    for ext in extensions:
        ext_path = Path(ext)
        if not ext_path.is_absolute():
            ext_path = AGENT_DIR / ext
        if not ext_path.exists():
            errors.append(f"extensions: path does not exist: {ext}")

    return errors


def main() -> int:
    if not AGENTS_DIR.exists():
        print(f"No {AGENTS_DIR} directory -- nothing to lint.")
        return 0

    enabled_models = load_enabled_models()
    justified_models = load_justified_models()

    failed = 0
    checked = 0
    for path in sorted(AGENTS_DIR.glob("*.md")):
        checked += 1
        errors = lint_file(path, enabled_models, justified_models)
        if errors:
            failed += 1
            print(f"FAIL {path.name}:", file=sys.stderr)
            for e in errors:
                print(f"  - {e}", file=sys.stderr)
        else:
            print(f"ok   {path.name}")

    print(f"\n{checked - failed}/{checked} agent files passed lint")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
