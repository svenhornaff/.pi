# GLM-5.2 Usage Reconciliation — 2026-08-31

Dashboard values for 2026-08-31 (GLM-5.2 only):

- **Input Tokens: 9,641,472**
- **Output Tokens: 291,655**

Reconciled against raw `agent/sessions/**/*.jsonl` history, filtered to GLM-5.2
usage records timestamped 2026-08-31, across **every** session directory (not
just `cv-review`).

## Per-project breakdown

| Project | Sessions | Turns | Fresh input | Cache read | Cache write | Input-equiv (fresh+cacheRead+cacheWrite) | Output |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `cv-review` | 5 | 168 | 736,524 | 8,008,512 | 0 | **8,745,036** | 258,559 |
| `/tmp/tmp.DKh5He03Tb` (git-repo) | 7 | 17 | 8,877 | 135,104 | 0 | **143,981** | 2,140 |
| `/tmp/tmp.D0044oF1Vz` (git-repo) | 7 | 16 | 680 | 134,016 | 0 | **134,696** | 1,920 |
| `/tmp/tmp.O8X9jZ4TKt` (git-repo) | 7 | 15 | 658 | 125,632 | 0 | **126,290** | 2,141 |
| `/tmp/tmp.qZuWt1TTbs` (git-repo) | 7 | 15 | 8,230 | 117,632 | 0 | **125,862** | 1,379 |
| `~/.pi` (root config sessions) | 13 | 17 | 56,745 | 39,104 | 0 | **95,849** | 9,243 |
| `/tmp/tmp.DKh5He03Tb` (plain-dir) | 1 | 2 | 101 | 16,640 | 0 | **16,741** | 60 |
| `/tmp/tmp.qZuWt1TTbs` (plain-dir) | 1 | 2 | 98 | 16,640 | 0 | **16,738** | 61 |
| `/tmp/tmp.O8X9jZ4TKt` (plain-dir) | 1 | 2 | 96 | 16,640 | 0 | **16,736** | 55 |
| `/tmp/tmp.D0044oF1Vz` (plain-dir) | 1 | 2 | 96 | 16,640 | 0 | **16,736** | 52 |
| **TOTAL (all projects, GLM-5.2)** | **50** | **256** | **812,105** | **8,626,560** | **0** | **9,438,665** | **275,610** |

## Reconciliation vs. dashboard

| | Input-equiv | Output |
| --- | ---: | ---: |
| Dashboard | 9,641,472 | 291,655 |
| Raw session total (all projects) | 9,438,665 | 275,610 |
| **Gap** | **202,807 (2.1%)** | **16,045 (5.5%)** |

## Conclusion

The dashboard's ~9.6M figure is `fresh input + cacheRead + cacheWrite` for
GLM-5.2 (cacheWrite is 0 in every session — consistent with GLM's implicit/
automatic caching). It reconciles to **97.9%** of the summed session-history
JSONLs once every GLM-5.2 session across every project directory that day is
included, not just `cv-review`.

- `cv-review` alone accounts for 8,745,036 tokens — **92.6%** of the all-project
  total.
- The remaining ~0.69M is spread across four `/tmp` scratch git-repo sessions
  (a few short rounds each — likely smoke-test runs) and `~/.pi` config-directory
  sessions.
- The residual 2.1%/5.5% gap is most likely a handful of GLM-5.2 sessions
  outside the `agent/sessions/` scan used here (a different session store, or a
  UTC/local-day boundary difference for what counts as "2026-08-31").

Of the all-project input-equivalent total, **91.4% (8,626,560 tokens) is
`cacheRead`** — free tokens, not fresh processing. Only **8.6% (812,105
tokens)** is genuinely fresh input.

## The dashboard is misleading

`docs/images/dah-glm-5.2-token-usage-2026-08-31.png` — the "DAH" dashboard's
Total/Input/Output Token Usage charts for GLM-5.2 — confirms the dashboard's
own arithmetic is internally consistent: **Input Tokens (9,641,472) + Output
Tokens (291,655) = Total Tokens tooltip (9,933,127)** for 2026-08-31, matching
the visible chart exactly. So the dashboard isn't broken math — it's a
misleading **presentation**.

The problem is what the "Input Token Usage" bar is labeled as, versus what it
actually contains:

1. **It conflates three very different cost/behavior categories into one
   number.** The 9.6M "Input Tokens" bar is `fresh input + cacheRead +
   cacheWrite` summed together with no distinction:
   - Fresh input (~812K, full price) — actual new work
   - Cache read (~8.6M, **free** for GLM-5.2) — reused context, essentially costless
   - Cache write (0 for GLM-5.2)

   A viewer sees "9.6M input tokens" and reasonably assumes ~9.6M tokens' worth
   of processing cost/load, when **91% of that bar is free cache hits**.
   There's no visual or numeric split between "expensive fresh tokens" and
   "free cached tokens" — they're summed as if equivalent.

2. **It implies a cost signal that isn't there.** A 9.6M-token day *sounds*
   alarming (roughly 3–10x the other visible days in the chart — 2026-08-25
   and 2026-08-27 are both under 3M), but the actual billable fresh-token
   footprint is only ~812K — closer to what you'd expect from a normal-to-heavy
   day of `cv-review` work. The chart amplifies perceived usage/cost by ~12x
   versus what's actually billed.

3. **It obscures whether caching is working.** Ironically, a huge "Input
   Tokens" bar is what caching *success* looks like (heavy context reuse), not
   failure — but the chart presents it as raw volume with no cache-hit-rate
   framing, so it reads as "usage exploded" rather than "cache is doing its
   job, only ~8% is fresh."

4. **Scope note (separate, smaller issue):** the ~2–5% gap between the
   dashboard (9,641,472 / 291,655) and the reconciled raw sessions (9,438,665 /
   275,610) documented above is not explained by the caching conflation — it's
   most likely a few GLM-5.2 sessions outside the `agent/sessions/` directories
   scanned here, or a UTC/local-day boundary difference for what counts as
   "2026-08-31."

**Bottom line:** the dashboard isn't arithmetically wrong, but it presents a
cache-inflated aggregate as if it were a straightforward usage/cost metric,
with no breakdown of fresh vs. cached tokens. A clearer presentation would
either (a) stack the "Input Token Usage" bar into fresh/cacheRead/cacheWrite
segments, or (b) annotate each bar with a cache-hit-rate percentage, so a 9.6M
day and an (hypothetical) 9.6M-all-fresh day are visually distinguishable —
right now they'd render identically despite one costing ~12x the other.
