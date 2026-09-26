# Evaluation cycle history

Concept: `../subagent-eval.md`. Phase 0 entry criteria: `../../subagent_concept.md` §7 Phase 0.

## Cycles

### C1 — 2026-09-26

- pi version: `0.87.1`
- `defaultModel`: `openrouter/anthropic/claude-sonnet-5`
- `defaultThinkingLevel`: `medium`
- Benchmark repos (pinned at `eval/base`):
  - `~/pi-eval/repos/click` — pallets/click @ `06b2a67` (2026-09-22), Python, ~9k LOC, pytest, ~4.5s
  - `~/pi-eval/repos/commander` — tj/commander.js @ `ba6d13d` (2026-05-29), TypeScript/JS, ~19.6k LOC, `node --test`, ~4s
  - `~/pi-eval/repos/doc-manager` — frozen snapshot of `/Users/brooklyn/Workspace/doc-manager` @ `a3da002` (2026-06-05), Python/FastAPI, ~26k LOC, pytest, ~4.6s
- Notes:
  - `doc-manager`'s test suite requires `LLMHUB_API_KEY` and `TAVILY_API_KEY` to be
    non-empty (pydantic-settings validation) but the real `.env` was correctly
    **not** copied into the frozen snapshot (protected-paths.ts also blocks
    writing any `.env*` file, by design). Export dummy values as process env
    vars instead of a file, e.g.:
    ```bash
    export LLMHUB_API_KEY=eval-dummy-not-a-real-key TAVILY_API_KEY=eval-dummy-not-a-real-key
    ```
    This must be included in every `doc-manager` task card's test command and
    in the pi command printed by `eval-worktree.sh` when invoked against it.
  - `execa` was evaluated as the TS/Node public repo but rejected: full test
    suite took 5m18s, over the `<2min` criterion (§3.1). Replaced with
    `commander.js` (~4s).
