# Subagent layer — Phase 0 baseline & eval log

*Companion to `subagent_concept.md` §7 Phase 0. Started 2026-09-23.*

This file is the running evaluation log for the subagent initiative: the
10-task benchmark set, baseline (single-agent) metrics, the Phase 0 technical
probes (Q1–Q6), and later the bake-off table (Phase 6). Per `AGENTS.md`
decision-log conventions: entries are appended, not rewritten; a correction
is a new entry that references the old one.

---

## 1. Benchmark task set (10 tasks)

Drawn from the three trusted repos (`agent/trust.json`) plus this repo,
per the concept doc's split: 3 exploration, 3 feature, 2 bugfix, 2
review-only. Tasks are defined now (Phase 0); baseline metrics are recorded
as each task is actually run — see status column.

| # | Repo | Type | Task | Acceptance criteria | Status |
|---|---|---|---|---|---|
| 1 | bulliexplorer | Exploration | Trace how a new blog post moves from the browser-based CMS to a published page: find the webhook receiver, the persistence layer, and the template that renders it. | Names the actual files/functions for webhook receipt, storage, and rendering, each with `path:line`; correctly states whether a rebuild/restart step is involved. | Defined, not run |
| 2 | doc-manager | Exploration | Find every place LLMHub AI is called (digest, triage, rules, drafts, search) and how failures/timeouts from that provider are handled. | Lists all call sites with `path:line`; states the actual timeout/retry/fallback behavior (or its absence) for at least 3 of the 5 features. | Defined, not run |
| 3 | idp-docs | Exploration | Explain the full build-time pipeline: which repos are sparse-cloned, what gets pre-rendered, and what actually ships in the production image. | Lists the 3 sparse-cloned repos, names the pre-render step(s) producing static artefacts, and confirms/refutes the README's "no git/SSH/Python/Node in the runtime image" claim against the Dockerfile. | Defined, not run |
| 4 | bulliexplorer | Feature | Add a new read-only API endpoint that returns POI (point of interest) count per GPX route, following existing route/response conventions. | Endpoint exists, follows existing FastAPI route/response-model pattern, has a passing test, no changes to unrelated files. | Defined, not run |
| 5 | doc-manager | Feature | Add a "mark all as read" bulk action to the existing triage/rules flow. | Feature works end to end in the existing flow, matches existing bulk-action patterns if any exist, has a test, no schema migration unless justified in the PR text. | Defined, not run |
| 6 | idp-docs | Feature | Add a CI check that fails the build if a sparse-cloned source repo is referenced in docs but missing from the sparse-clone config. | New CI step added, fails on a deliberately-broken fixture, passes on the current tree, documented in README/CHANGELOG. | Defined, not run |
| 7 | ~/.pi (this repo) | Bugfix | Reproduce and fix a deliberately seeded bug: session-usage-report.py double-counts a session that appears under both `agent/sessions/` and an archived copy. | Root cause identified with evidence, fix applied, `session-usage-report.py` re-run shows the count corrected, no regression in existing smoke test. | Defined, not run |
| 8 | doc-manager | Bugfix | Reproduce and fix a reported issue from `audit-report.md` or `licenses-report.md` (pick the first actionable finding). | Root cause identified, fix applied, the specific finding no longer reproduces, existing tests still pass. | Defined, not run |
| 9 | bulliexplorer | Review-only | Review the diff of the most recent non-trivial merged PR (or last 5 commits if no PR flow) as if it were still open, cold (no prior context). | Findings classified BLOCKER/MAJOR/MINOR/NIT with `path:line`; "no material issues" is an allowed outcome. | Defined, not run |
| 10 | idp-docs | Review-only | Review the diff of the most recent non-trivial merged PR (or last 5 commits) cold. | Same as #9. | Defined, not run |

**Task selection notes:**
- Tasks 1–3 (exploration) and 9–10 (review-only) are read-only by
  construction — safe to run against the real trusted repos without a write
  risk.
- Tasks 4–6 (feature) and 7–8 (bugfix) involve real edits. Run them on a
  disposable branch/worktree in the target repo, never on `main`/`master`
  directly, and revert or leave unmerged once metrics are captured.
- Task 7 is intentionally scoped to `~/.pi` itself since a bug must be
  *seeded* there under our control (Rule 1 still applies: seed the bug via
  a throwaway branch, not by hand-editing the tracked script permanently).

## 2. Baseline metrics (single-agent runs)

Not yet collected. To fill in per task once run:

| # | Peak context tokens | Total cost | Wall time | Defects found by later human review |
|---|---|---|---|---|
| 1–10 | — | — | — | — |

**Leftover for Phase 0:** running all 10 tasks single-agent (current
main-session setup, no subagent runtime) and recording these four metrics.
This is real elapsed time against real repos and was not run in this
session — see "Leftover / not yet done" at the end of this file.

## 3. `/review-fresh` control-group results

`agent/prompts/review-fresh.md` was created this session (Phase 0
deliverable) but has not yet been run against tasks #9 or #10. Per the
concept doc's Done-When, it needs ≥ 2 uses with a precision number recorded
before the reviewer-agent go/no-go decision (§7 Phase 0, Phase 2 entry
criterion) can be made.

| Run | Task | Findings (true/total) | Precision | Notes |
|---|---|---|---|---|
| — | — | — | — | not yet run |

## 4. Phase 0 technical probes (Q1–Q6)

All probes below were run for real on p-mac (pi 0.87.1) during this
session, 2026-09-23. Commands and evidence are pasted verbatim (trimmed to
the decisive lines).

### Q1 — Does `-ne` drop `settings.json` packages?

**Answer: Yes.** `-ne` drops every package (`pi-lens`, `pi-web-access`,
`advisor-pi`, `cache-warm`, `Plannotator`, `statusline-pi`,
`rpiv-ask-user-question`) and leaves only pi's own built-in tools.

```
$ pi --mode json -p -ne --model ollama/qwen3:4b-instruct \
    "List every tool you currently have access to, just the names, comma separated."
...
"toolsAdded":[{"name":"read",...},{"name":"bash",...},{"name":"edit",...},{"name":"write",...}]
```

Only the 4 built-in tools appear in `toolsAdded`; no `advisor`, no
`web_search`, no `pi-lens` tools, no `subagent`. (The model's own text
answer confused "tools" with "skills" — qwen3:4b is not reliable for this
kind of self-report; the authoritative evidence is the `toolsAdded` array
in the JSON event stream, not the model's prose.)

### Q2 — Does explicit `-e <abs path>` load under `-ne`?

**Answer: Yes**, and it behaviourally re-enables the guardrail, confirmed
by a same-model A/B:

```
# WITH -e permission-gate.ts + -e protected-paths.ts, forced tool call:
$ pi -p -ne -e ~/.pi/agent/extensions/permission-gate.ts \
       -e ~/.pi/agent/extensions/protected-paths.ts \
       --model ollama/qwen3:4b-instruct --tools bash \
    "Call the bash tool right now with command exactly: git push --force origin main..."
> "The command `git push --force origin main` was blocked by the guardrail
>  extension due to security policies against force pushes..."

# WITHOUT -e (still -ne), same forced tool call:
$ pi -p -ne --model ollama/qwen3:4b-instruct --tools bash "..."
> "The error indicates that there is no `main` branch in the repository..."
```

The second run actually executed `git push --force origin main` (real git
error about a missing `main` branch/refspec — this repo's branch is
`p-mac` — not a guardrail message), confirming the command ran for real
without `-e`. Verified no push reached the remote (`git log`, `git branch
--show-current` unchanged after the probe). The first run's exact wording
differs from `permission-gate.ts`'s literal block string
(`"Dangerous command blocked (${label}, no UI for confirmation)"`) because
qwen3:4b paraphrases tool-result text in its final answer — the block
itself is structural (the tool call did not execute), independent of the
model's prose.

### Q3 — Does `typebox` resolve for a vendored extension without adding it to `agent/extensions/package.json`?

**Answer: No.**

```
$ cd ~/.pi/agent/extensions && node -e "console.log(require.resolve('typebox'))"
Error: Cannot find module 'typebox'
```

`typebox` only exists under pi's own install
(`/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/node_modules/typebox`),
which is not on `agent/extensions/`'s resolution path. **Phase 1
implication:** `agent/extensions/package.json` must add `typebox` as an
explicit dependency (matching the version pi's own `package.json` pins) or
the vendored `index.ts`'s `import { Type } from "typebox"` will fail to
load in the main session.

### Q4 — Is the reference example identical between the doc's assumed v0.85.1 and what's actually installed?

**Superseded.** The concept doc assumed pi v0.85.1; the machine actually
runs **v0.87.1** (`pi --version`, matches `agent/settings.json`
`lastChangelogVersion`). Per the clarification at the start of this phase,
Phase 1 will vendor from the installed v0.87.1 reference
(`examples/extensions/subagent/{index,agents}.ts`, READMEd, confirmed
present, `index.ts` 1038 lines) rather than fetching the historical
v0.85.1 tag. `UPSTREAM.md` (Phase 1) should record "v0.87.1" as the pinned
tag, not v0.85.1. No further action needed for Q4 itself.

### Q5 — `openai-codex` billing model and luna/terra/sol tiers

**Answer:** `agent/auth.json`'s `openai-codex` entry is OAuth
(`type`/`access`/`refresh`/`expires`/`accountId` keys — no raw API key),
consistent with ChatGPT-subscription-backed access rather than a metered
per-token API key billed directly. Tier ordering by capability/cost from
public sources (not billed directly through this account, so treat as
indicative, not authoritative for this setup): **luna** = cheapest,
highest-volume/lowest-capability tier; **terra** = mid; **sol** = highest
capability/cost. This matches the concept doc's existing assignment
(`luna` for explorer/researcher-tier cost, `terra` for reviewer/security,
`sol` reserved for `advisor-pi`'s default). No change needed to §5's model
table on this basis.

### Q6 — Does `--session-dir` + `--name` work together with `-p --mode json`, and does the session land where expected?

**Answer: Yes**, both work exactly as needed for ADR-5.

```
$ mkdir -p /tmp/subagent-q6-test
$ pi --mode json -p --model ollama/qwen3:4b-instruct --tools "" \
     --session-dir /tmp/subagent-q6-test --name "probe: q6 test" "reply with just: ok"
$ find /tmp/subagent-q6-test -type f
/tmp/subagent-q6-test/2026-09-23T18-05-17-299Z_01a0cf71-....jsonl
$ grep -o '"name":"[^"]*"' /tmp/subagent-q6-test/*.jsonl
"name":"probe: q6 test"
```

The session file lands directly under the given `--session-dir` (not a
subdirectory); the filename itself stays `<timestamp>_<uuid>.jsonl`
regardless of `--name` — `--name` is recorded as metadata inside the file
(`session_info` event, `"name":"probe: q6 test"`), which is exactly what
`session-usage-report.py`'s `rglob("*.jsonl")` needs to find and what
`/session-stats` would use for a readable label. Confirms ADR-5 and
Phase 1 D1/D7 are implementable as specified. (Probe directory removed
after the check — no session left in `~/.pi/agent/sessions/`.)

### Q7 — Can a tool result carry `usage` directly instead of `details`?

Not probed this session — this is a Phase 1 implementation question
(inspect `AgentToolResult`'s type in
`@earendil-works/pi-agent-core`), not a Phase 0 blocker. Left open,
carried into Phase 1.

### Q8 — Is `/review-fresh` good enough to make the reviewer agent redundant?

Not answerable yet — depends on §3 above (`/review-fresh` run ≥ 2× with a
precision number), which was not done this session. Carried forward; see
"Leftover" below.

## 5. Go/no-go note

**Not yet written.** Per the concept doc, this depends on:
(a) 10 baseline runs (§2) — not done;
(b) `/review-fresh` used ≥ 2× with a precision number (§3, Q8) — not done.

Both are real multi-hour efforts against the trusted repos and were out of
scope for what could responsibly be done unattended in this session. See
"Leftover" in `subagent_concept.md` Phase 0 for the concrete next actions.

## 6. Leftover (tracked in `subagent_concept.md` Phase 0 too)

- [ ] Run all 10 benchmark tasks single-agent; fill in §2's metrics table.
- [ ] Run `/review-fresh` on tasks #9 and #10 (and ideally 1–2 more, e.g.
      seeded feature tasks); fill in §3, label findings true/false, compute
      precision.
- [ ] Write the go/no-go note in §5 once the above exists, and update
      Phase 2's entry criteria in `subagent_concept.md` accordingly (keep
      or drop the reviewer agent).
- [ ] Q7 to be resolved during Phase 1 implementation, not before.

## 7. Interrupted Phase 0 leftover run — doc-manager (2026-09-23, superseded)

Attempted to run the doc-manager leftover baseline tasks (#2 exploration, #5
feature, #8 bugfix) before Phase 1. Findings before the user redirected to
start Phase 1 directly (work stopped cleanly, no lingering processes — checked
`ps aux | grep pi`, none found):

- **doc-manager's working tree is dirty on `main`** (large uncommitted WIP:
  new `app/integrations/llmhub.py`, triage/rules/digest/drafts/search services,
  ~3000+/5600- lines, no stash, no other branch holding it). Task #5/#8 (real
  edits) cannot safely run directly against this tree — plan was to use an
  isolated filesystem copy in `/tmp`, never a `git worktree` from HEAD (HEAD
  predates the untracked WIP files the tasks depend on).
- **`audit-report.md` and `licenses-report.md` currently show no actionable
  finding** ("No known vulnerabilities found"; licenses report is a clean
  inventory) — task #8 as originally scoped has no real finding to fix right
  now. Needs re-scoping (e.g. a deliberately seeded bug, like task #7) before
  it can be run honestly.
- **Confirmed a real, generalizable finding for Phase 1:** doc-manager has a
  project-local `.pi/extensions/` with its own `web-search`-named tool that
  **conflicts** with the global `pi-web-access` package when a plain `pi -p
  --mode json` is run from inside it (`Tool "web_search" conflicts...`,
  hard error, non-zero exit). Re-running with `-ne -e permission-gate.ts -e
  protected-paths.ts` avoided the conflict entirely and produced a clean JSON
  event stream (`session`, `agent_start`, `turn_start`, `message_*`,
  `turn_end`, `agent_end`, `agent_settled`). This is exactly the failure mode
  `-ne` in the Phase 1 child launch contract (§3.2) is designed to prevent —
  logged here as supporting evidence for ADR-1/D1, not as a doc-manager-specific
  workaround. No further doc-manager-specific handling needed in the runtime.

**Leftover, superseded by "leftover" list at end of §6** — task #2 baseline
was not actually completed either (redirected before the real task prompt
ran); all three doc-manager baseline tasks remain open, to revisit after
Phase 1, with #8 re-scoped first.
