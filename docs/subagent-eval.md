# Evaluation Concept — Subagent Layer for `.pi` @ `p-mac`

*Status: proposal · Companion to `subagent_concept.md` (§7 Phase 0, §8.4, Phase 6) · Scope: generic, project-independent*

---

## 1. Purpose

Answer one question with evidence instead of impressions: **does a given subagent (or flow) make pi better enough to justify its cost?**

"Better" means one or more of:

- **Quality:** fewer defects escape, fewer human corrections.
- **Focus:** the main session's context stays smaller, so reasoning late in a session stays sharp.
- **Effort:** less of your time spent steering.

"Cost" means money (parent + children), wall time, and added workflow friction.

The evaluation produces a **baseline** (no subagents) and then compares each phase's variant against it. Every keep/kill decision in the concept points to a row in this evaluation.

## 2. Principles

- **Finite, frozen benchmark.** Tasks run against a frozen snapshot, never against a living project. Active projects keep moving, so results would never be comparable and the evaluation would never end.
- **Same input, different variant.** Same commit, same task text, same main model, same pi version. Only the variant under test changes.
- **You are the judge.** Pi cannot score its own work. Acceptance checks, finding labels and defect answer keys are human-owned.
- **Answer keys stay invisible to agents.** Anything the agent could read under its working directory contaminates the run.
- **Small and repeatable beats large and once.** Six well-defined tasks you can re-run in half a day are worth more than twenty you run once.
- **Metrics come from session files, not memory.** Numbers are extracted by script; judgments are recorded right after the run.

---

## 3. Benchmark design

### 3.1 Benchmark repositories

Tasks live in a dedicated benchmark workspace, separate from real projects:

```text
~/pi-eval/
├── repos/                 # pinned clones used ONLY for evaluation
│   ├── bench-a/           # e.g. small TypeScript/Node app with tests
│   ├── bench-b/           # e.g. small Python service/CLI with tests
│   └── bench-c/           # e.g. a frozen snapshot of one of your own repos
├── answers/               # answer keys — NEVER inside a repo, never given to agents
└── runs/                  # optional scratch; worktrees go to /tmp/eval-*
```

What a benchmark repo needs:

| Criterion | Why |
|---|---|
| Has a runnable test suite (< 2 min) | Acceptance can be checked objectively; the verifier has something to run |
| 2k–30k LOC, 20–300 files | Big enough that exploration matters, small enough to run quickly |
| Understandable to you without much ramp-up | You must be able to judge correctness |
| Pinned at a fixed commit (`eval/base`), never updated during an evaluation cycle | Comparability |
| No secrets, no production credentials | Children read broadly |
| Mix of languages across the set (at least 2) | Avoids tuning agents to one ecosystem |

Recommended set: **3 repos**:

- 2 small public open-source projects with good tests;
- 1 frozen snapshot of a repo of your own, copied at a commit and never synced again.

The `~/.pi` config repo itself is a valid fourth candidate for exploration tasks, again frozen at a commit.

### 3.2 Task classes

| Class | Count (min / full) | What it tests | Typical agent under test |
|---|---|---|---|
| **E — Exploration** | 2 / 3 | Understanding unfamiliar code, context economy | explorer |
| **F — Feature** | 2 / 3 | Design + implementation across several files | architect, reviewer, verifier |
| **B — Bugfix** | 0 / 2 | Fault localisation + fix + proof | explorer, verifier |
| **R — Review-only** | 2 / 2 | Finding a seeded defect in a diff | reviewer, security, `/review-fresh` |
| **Total** | **6 / 10** | | |

The 6-task minimum is enough for go/no-go decisions. Use the 10-task set for Phase 6 tuning. Below 6, results are noise.

### 3.3 Task selection rules

- **Size:** 20–60 minutes of pi work in the baseline.
- **Well-defined done:** the task must have a checkable definition of done.
- **Spread:** each class spans at least two different benchmark repos.
- **At least one F task crosses a module boundary.** That is where architect and explorer should help.
- **No trivia:** single-line fixes, renames and pure formatting are excluded.
- **Realism:** a task must be something you would plausibly do in real work.
- **Fixed once set:** a task never changes after its first run. A changed task becomes a new task ID.

### 3.4 Task card (one file per task: `docs/eval/tasks/<ID>.md`)

```markdown
---
id: F02
class: feature            # exploration | feature | bugfix | review
repo: bench-b
base: eval/base           # branch or SHA
created: 2026-09-26
---
## Task text (pasted verbatim into every run)
<one paragraph, written as you would normally ask pi>

## Done means (acceptance criteria)
- AC1: <observable, checkable>
- AC2: <…>
- AC3: existing test suite passes (`<test command>`)

## Out of scope
<what must NOT change>

## Answer key
~/pi-eval/answers/F02.md   (not readable by agents; exploration/review tasks only)
```

Guidance for acceptance criteria by class:

| Class | Good acceptance criteria |
|---|---|
| Exploration | Names specific files/functions, describes one call path correctly, identifies where a named change would go |
| Feature | Observable behaviour, a new or updated test, suite green, no out-of-scope files touched |
| Bugfix | Reproducer fails before and passes after, suite green, root cause named correctly |
| Review | The seeded defect is reported with correct location and at least MAJOR severity |

### 3.5 Seeded defects (review tasks; reused for verifier false-PASS tests)

Prepare a branch `eval/<ID>-diff` containing a plausible change with **exactly one** deliberate defect. Record in the answer key:

- defect type, file and line;
- why it is a defect;
- the minimum severity a competent reviewer should assign.

Good defect types:

- missing authorisation or input validation;
- off-by-one or boundary error;
- unhandled error path;
- resource leak;
- race or ordering bug;
- silently swallowed exception;
- a test that asserts the wrong thing.

Keep it realistic, with no comments or naming that hints at it. Rotate defect types across tasks so agents aren't tuned to one pattern.

---

## 4. Variants

A variant is a configuration under test. The baseline is always run first.

| Variant | Setup | Used from |
|---|---|---|
| **V0 Baseline** | `pi --exclude-tools subagent`; default model and thinking | Phase 0 |
| **V0r Review-fresh** | Baseline + `/review-fresh` (branch-based review, no runtime) | Phase 0 (R tasks) |
| **V1 Explorer** | Subagent runtime; explorer only; you invoke it explicitly | Phase 2 |
| **V2 Reviewer** | V1 + reviewer | Phase 2 (if go) |
| **V3 Design** | `/design` (explorer → architect → Plannotator) | Phase 3 |
| **V4 Ship-check** | V3 + `/ship-check` (reviewers → verifier) | Phase 4 |
| **V5 Full** | V4 + security/researcher where triggered | Phase 5 |
| **Vm Model A/B** | Any variant with one agent's model swapped | Phase 6 |

Which tasks each variant runs on:

| | E | F | B | R |
|---|---|---|---|---|
| V0 | ✓ | ✓ | ✓ | ✓ |
| V0r | | | | ✓ |
| V1 | ✓ | ✓ | ✓ | |
| V2 | | ✓ | | ✓ |
| V3 | | ✓ | | |
| V4 | | ✓ | ✓ | ✓ (verifier false-PASS test) |

---

## 5. Run protocol

### 5.1 Before a run

- Confirm the pi version (`pi --version`) and the model set match the evaluation cycle (see §9).
- Create a clean worktree from the task's base:

```bash
~/.pi/scripts/eval-worktree.sh <repo> <TASK-ID> <VARIANT>
# creates /tmp/eval-<TASK-ID>-<VARIANT> from eval/base (or eval/<ID>-diff for review tasks)
# prints the pi command for the variant, e.g.:
#   pi --exclude-tools subagent --name "eval F02 V0"
```

- Note the start time.

### 5.2 During a run

- Paste the task text verbatim; add nothing.
- Answer pi's direct questions briefly and factually. Answering a question pi asked is **not** an intervention.
- **Count interventions:** any unsolicited correction, redirection, hint or "no, look at X". Keep a tally.
- **No rescue rule:** if pi is clearly stuck for more than 10 minutes, or heading toward out-of-scope changes, intervene once, log it, and continue. After 3 interventions, mark the run `assisted`.
- Do not use features outside the variant. In V0 that means no subagents and no advisor unless pi calls it itself; log advisor calls.

### 5.3 After a run

- Check every acceptance criterion yourself and mark it met or not met.
- For review tasks, label every finding (§6.3) and note whether the seeded defect was caught.
- Extract metrics:

```bash
python3 ~/.pi/scripts/eval-metrics.py --since <start-time> --cwd-contains eval-<TASK-ID>-<VARIANT>
```

- Record the row (§8) immediately, while the details are fresh.
- Remove the worktree: `git -C ~/pi-eval/repos/<repo> worktree remove /tmp/eval-<TASK-ID>-<VARIANT>`.

### 5.4 Repetitions

Model output varies between runs.

- **Go/no-go decisions:** one run per task per variant is acceptable when the difference is large (> 30%).
- **When a decision hinges on a small difference**, run the tasks involved a second time and use the mean. Record `run: 1/2`.
- **Phase 6 model A/B:** 2 runs per task per candidate.

---

## 6. Metrics and scoring

### 6.1 Automatic (from `eval-metrics.py`)

| Metric | Definition |
|---|---|
| `cost_main` | Sum of `usage.cost` over the main session (assistant + tool-internal + compaction) |
| `cost_child` | Sum over child sessions in `sessions/subagents/` for the run |
| `cost_total` | `cost_main + cost_child` |
| `peak_ctx` | Largest single prompt sent in the main session (`input + cacheRead + cacheWrite`) |
| `turns` | Assistant turns in the main session |
| `compactions` | Compaction entries in the main session |
| `minutes` | First to last timestamp of the main session |

`eval-metrics.py` must be validated once against `/session-stats`: its main-session cost must match `/session-stats` for that session.

### 6.2 Manual (recorded by you)

| Metric | Definition |
|---|---|
| `ac_met` | Acceptance criteria met / total |
| `interventions` | Count per §5.2 |
| `assisted` | Yes if ≥ 3 interventions |
| `scope_ok` | No out-of-scope files changed (`git diff --stat` vs task card) |
| `escaped` | Defects discovered **after** the run in the produced change. Can be updated later |
| `plan_score` | F tasks with a design step: 1–5 (§6.4) |

### 6.3 Finding labels (review, security, reviewer agents, `/review-fresh`)

| Label | Meaning | Precision weight |
|---|---|---|
| TRUE | Real issue at the stated location, severity reasonable | 1 |
| PARTIAL | Real issue, wrong severity or imprecise location | 0.5 |
| FALSE | Not an issue, invented, or already covered by lint/types | 0 |

- `precision = Σ weights / number of findings`. If there are zero findings, precision is n/a, and whether the seeded defect was caught decides the outcome.
- `seeded_caught` = yes / no (review tasks).
- `false_pass` = verifier said PASS on a task with a seeded defect (V4).

### 6.4 Plan score (F tasks with a design step)

| Score | Meaning |
|---|---|
| 5 | Could implement directly; risks and acceptance criteria correct |
| 4 | Minor gaps you'd fix in 1–2 comments |
| 3 | Usable but missed a relevant constraint or file |
| 2 | Wrong in a way that would have caused rework |
| 1 | Not usable |

---

## 7. Decision rules

All ratios compare against V0 on the **same tasks**.

### 7.1 Phase 0 — reviewer go/no-go (from V0r on R tasks)

- **Build the reviewer agent (Phase 2)** if any of these holds:
  - `/review-fresh` missed a seeded defect;
  - `/review-fresh` precision < 0.6;
  - its friction means you would not use it routinely.
- **Skip the reviewer agent** if it caught all seeded defects, precision ≥ 0.6, and you would use it routinely.

### 7.2 Phase gates

| Agent / flow | Keep if | Kill or rework if |
|---|---|---|
| explorer (V1) | E tasks: `peak_ctx` ≤ 0.7× V0 **and** `cost_total` ≤ 1.3× V0 **and** ≥ 90% of 10 sampled `path:line` citations correct | Citation accuracy < 80%, or cost > 1.5× with no ctx gain |
| reviewer (V2) | precision ≥ 0.6 **and** caught ≥ 1 real MAJOR+ issue V0r missed | precision < 0.5 after 1 prompt revision |
| architect (V3) | median `plan_score` ≥ V0 plan (or ≥ 4) **and** `cost_total` ≤ 1.5× V0 **and** interventions ≤ V0 | plan_score < 3 on ≥ 2 tasks |
| verifier (V4) | 0 false PASS **and** `ac_met` judgments agree with yours ≥ 90% | Any false PASS after 1 prompt revision |
| security (V5) | Catches seeded security defect(s); precision ≥ 0.6 | Misses seeded defect, or mostly FALSE findings |
| researcher (V5) | Answer correct + sourced on trigger cases; main `peak_ctx` lower than V0 on those | Stale or wrong facts |

### 7.3 Aggregate (Phase 6 steady state)

Across the full task set:

- `cost_total` ≤ 1.4× V0
- **and** `escaped` ≤ V0
- **and** main `peak_ctx` ≤ 0.8× V0
- **and** interventions ≤ V0

If this is not met, fall back to the minimal set (explorer + `/review-fresh`) and record the fallback as a deliberate decision.

### 7.4 Prompt-revision budget

Each agent gets at most **2** prompt revisions per evaluation cycle, each logged with its reason. After that, the gate result stands. This prevents endless tuning.

---

## 8. Recording

### 8.1 Files

```text
docs/eval/
├── README.md            # this concept (or link), cycle history
├── tasks/<ID>.md        # task cards (§3.4)
├── runs.md              # one row per run (§8.2)
├── findings.md          # one row per finding for review-type runs (§8.3)
└── decisions.md         # gate outcomes, go/no-go notes, prompt revisions
~/pi-eval/answers/<ID>.md   # answer keys — outside every repo
```

### 8.2 `runs.md`

| date | cycle | task | variant | run | pi | main model | cost_main | cost_child | peak_ctx | turns | compactions | minutes | ac_met | interventions | assisted | scope_ok | escaped | plan_score | notes |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|

### 8.3 `findings.md`

| date | task | variant | agent | finding (short) | location | severity given | label | seeded? |
|---|---|---|---|---|---|---|---|---|

### 8.4 `decisions.md` entry format

```markdown
## 2026-10-02 — Phase 0 reviewer go/no-go (cycle C1)
Decision: build reviewer in Phase 2
Evidence: V0r precision 0.45 (R01, R02); seeded caught 1/2 (missed R02 unhandled error path)
Reverse if: V2 reviewer precision < 0.5 after one revision
```

---

## 9. Evaluation cycles and regression

An **evaluation cycle** freezes: pi version, `enabledModels`, main model and thinking level, agent prompts, and benchmark repo commits. Name cycles `C1`, `C2`, and so on.

| Trigger | Action |
|---|---|
| Phase completion | Run that phase's variant on its tasks within the current cycle |
| pi upgrade | New cycle. Re-run V0 on the 6-task minimum plus the current steady-state variant, then compare with the previous cycle |
| Main model change | New cycle. Re-run V0 and the steady state |
| Agent model or prompt change | Re-run that agent's gate tasks only (same cycle, new variant label) |
| Quarterly (optional) | 6-task regression of the steady state |

Rules:

- Never compare numbers across cycles without re-running V0 in the new cycle.
- Benchmark repos are updated only when starting a new cycle, and then all task cards are re-validated.

This keeps the evaluation **bounded**: each cycle has a fixed task set and a fixed end point (all gates for the phase decided). Ongoing work happens only on explicit triggers.

---

## 10. Roles

| Activity | You | Pi |
|---|---|---|
| Choose benchmark repos and tasks, write task cards | ✓ | Drafts on request, you approve |
| Write answer keys / seed defects | ✓ | May help create the diff branch; never sees the answer key |
| Execute runs | Drive | Executes the task |
| Count interventions, check acceptance, label findings, score plans | ✓ | — |
| Extract metrics, fill numeric columns | — | ✓ (`eval-metrics.py`) |
| Gate decisions | ✓ | Writes the entry in `decisions.md` |
| Scaffolding (scripts, templates, smoke tests) | Review | ✓ |

---

## 11. Threats to validity (and mitigations)

| Threat | Mitigation |
|---|---|
| Run-to-run randomness | Repetitions on close calls (§5.4); decisions only on large differences |
| Learning effect: you steer better in later runs because you already know the task | Count interventions strictly; run V0 first; keep task text fixed; prefer tasks you haven't solved by hand |
| Answer-key leakage | Keys only in `~/pi-eval/answers/`; no hints in code, commits or branch names (`eval/<ID>-diff`, not `eval/<ID>-bug-in-auth`) |
| Benchmark too easy / too small | 20–60 min tasks, ≥ 2k LOC repos; discard tasks where V0 scores perfectly with 0 interventions and < 10 min |
| Tuning to the benchmark | Prompt-revision budget (§7.4); rotate defect types; validate the steady state on real work for one week before closing Phase 6 |
| Cost measurement gaps | `eval-metrics.py` validated against `/session-stats`; child sessions counted once (smoke S5/S6) |
| Advisor calls distorting cost | Log advisor calls per run; report them separately |

---

## 12. Tooling

| Tool | Purpose | Status |
|---|---|---|
| `scripts/eval-worktree.sh <repo> <ID> <variant>` | Create `/tmp/eval-<ID>-<variant>` from the right base; print the variant's pi command | To build |
| `scripts/eval-metrics.py` | Extract §6.1 metrics from session files; main vs. child separated | Drafted; validate against `/session-stats` |
| `agent/prompts/review-fresh.md` | V0r variant | Phase 0 |
| `docs/eval/*` templates | Task cards, runs, findings, decisions | To build |
| Smoke S5/S6 (priced cheap model) | Guarantees child cost is counted exactly once | Leftover from Phase 1 |

---

## 13. Phase 0 — Done When (evaluation part)

- [ ] `~/pi-eval/repos/` holds ≥ 3 benchmark repos, each pinned at `eval/base` with a green test suite
- [ ] ≥ 6 task cards (2 E, 2 F, 2 R) written and approved; answer keys stored in `~/pi-eval/answers/`
- [ ] `eval-worktree.sh`, `eval-metrics.py` (validated) and the `docs/eval/` templates in place
- [ ] Cycle C1 frozen and recorded (pi version, models, commits)
- [ ] V0 run on all tasks; `runs.md` complete
- [ ] V0r run on both R tasks; `findings.md` complete
- [ ] Reviewer go/no-go written in `decisions.md` per §7.1
- [ ] S5/S6 scripted with a priced model and green

Time budget: about half a day for setup (repos, cards, keys) plus about 4–6 hours of runs, spread across a week.