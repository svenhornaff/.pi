# Decisions (§8.4)

Gate outcomes, go/no-go notes, prompt revisions. Append-only — see the
`decisions.md` entry format in `../subagent-eval.md` §8.4.

## 2026-09-26 — Phase 0 reviewer go/no-go (cycle C1) — PRELIMINARY, NOT A DECISION

Status: **not decided yet** — §13 requires V0r on **both** R tasks before this
gate can be written; only R01 exists and has been run so far (R02 not yet
authored). This entry records what one data point shows, explicitly to avoid
a future reader mistaking a single sample for the actual go/no-go.

Evidence so far: R01 (commander, silently-swallowed-exception defect) — V0r
caught it, correct mechanism named, severity CRITICAL (>= MAJOR threshold).
1 finding, 1 TRUE, precision = 1.0 on this single task.

Per §7.1 this would point toward "skip the reviewer agent," but that
conclusion must not be drawn from n=1. **Do not close this gate** until R02
is written and run — see subagent_concept.md's Phase 0 leftover list.

## 2026-09-27 — R01 retired, no longer counts toward §7.1

R01 (commander, seeded silently-swallowed-exception defect) is retired from
the benchmark set to `status: smoke` in `docs/eval/tasks/R01.md` — see that
card's retirement note for the two reasons (§11 "too easy": 0 interventions,
~0.4 min; and answer-key exposure: the task card's own "Done means" named
the defect mechanism, and the seeded commit sits in public `commander` git
history). The prior entry in this file (2026-09-26, "PRELIMINARY, NOT A
DECISION") is **not rewritten** per this repo's decision-log convention —
this entry corrects it going forward: R01's 1/1 "seeded caught" data point
must not be used as evidence for or against the reviewer go/no-go. §7.1
still requires two non-smoke R tasks; current count is 0 of 2.
