# Runs (§8.2)

One row per run. Fill immediately after the run, from `eval-metrics.py` (automatic columns) plus your own judgment (manual columns).

| date | cycle | task | variant | run | pi | main model | mode | cost_main | cost_child | peak_ctx | turns | compactions | minutes | ac_met | interventions | assisted | scope_ok | escaped | plan_score | judged_by | countersigned | notes |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 2026-09-26 | C1 | E01 | V0 | 1/1 | 0.87.1 | anthropic/claude-sonnet-5 | print | 0.313835 | 0 | 49940 | 21 | 0 | 1.8 | 4/4 | n/a | no | yes | n/a | n/a | pi | no | smoke — excluded from gates (§11, too easy). Fresh non-interactive `pi -p` run. All AC met, all file:line citations spot-checked against source and correct (see setup-refactor-plan.md log entry). No files touched. |
| 2026-09-26 | C1 | R01 | V0r-proxy | 1/1 | 0.87.1 | anthropic/claude-sonnet-5 | print | 0.034355 | 0 | 14842 | 4 | 0 | 0.4 | 3/3 | n/a | no | yes | n/a | n/a | pi | no | smoke — excluded from gates (§11, too easy, and answer-key exposure). Fresh non-interactive `pi -p` review of eval/R01-diff vs master — not `/review-fresh`, no fork/friction measured, hence `V0r-proxy` not `V0r`. Did not run the test suite (verified: only bash git-diff + read tool calls). Seeded defect caught, correct mechanism described, severity CRITICAL (>= required MAJOR). |
