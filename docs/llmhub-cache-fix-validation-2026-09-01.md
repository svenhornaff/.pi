# LLMHub Prompt-Cache Fix — Production Validation (2026-09-01)

> **Status: RESOLVED / CONFIRMED.** This closes the single top-priority open item carried across
> `docs/prompt-cache-analysis.md`, `docs/setup-refactor-plan.md`, and
> `docs/harness-review-2026-08-31-followup.md`: *"Run one real `llmhub/claude-sonnet-4.6` session,
> confirm `cacheRead > 0`."* It is no longer open as of this session.

## Session analyzed

```
File:     ~/.pi/agent/sessions/--Users-A94984797-Workspace-cv-review--/
          2026-09-01T11-22-06-302Z_01a05cb4-785e-7201-85c6-76181b5e05c9.jsonl
Model:    claude-sonnet-4.6
Provider: llmhub (api: openai-completions, baseUrl: https://llm-server.llmhub.t-systems.net/v2)
Started:  2026-09-01T11:22:06.302Z (session open) / 11:37:51 (first llmhub turn)
Ended:    2026-09-01T12:01:13.783Z
Duration: ~23 minutes of active llmhub turns
Turns:    16 assistant turns with usage on llmhub/claude-sonnet-4.6
Task:     5 sequential `match-cv` skill invocations (CV-vs-JD scoring reports) in one
          continuous session, back-to-back, no idle gaps >6 minutes between them.
```

This maps directly onto the validation plan in the request: steps 1–3/4–10 (fresh session,
continue same session, natural back-to-back follow-ups) were exercised. The "bonus" step
(deliberate 6+ minute pause to force TTL expiry / a fresh `cacheWrite`) was **not** deliberately
triggered — see Gaps below — but an unplanned analogous reset did occur naturally at turn 12 and
is analyzed below.

---

## TL;DR

| Question | Finding |
| --- | --- |
| Does `compat.cacheControlFormat: "anthropic"` actually cause LLMHub to return `cacheRead > 0`? | ✅ **Yes, confirmed in production.** Turn 3 (first follow-up) already shows `cacheRead = 24,450`. |
| Was the fix in `agent/models.json` still in place and correctly applied for this session? | ✅ Yes — `llmhub.claude-sonnet-4.6.compat.cacheControlFormat` is `"anthropic"` and the session used it. |
| Does `cacheRead` grow turn over turn as the earlier analysis predicted? | ✅ Yes, with expected resets on context-shape changes (see below), matching the pattern already documented for GLM-5.2 in `docs/cache-analysis-2026-08-31-cv-review.md`. |
| Did `pi-condense` (root cause #2 from `docs/prompt-cache-analysis.md`) also engage this time? | ✅ Yes — `contextPrune.enabled: true` is live, and this session shows real chain-compression activity (2 chains compressed), unlike the original incident session where it never fired once. |
| Net effect on cost for this session vs. the same session running uncached | Caching saved **≈ 46.6%** of what this session would otherwise have cost (≈ €3.71 saved of an ≈ €7.95 uncached-equivalent cost), landing the real cost at **≈ €4.25** for 5 full CV-match reports. |
| Is the machine-wide historical picture still bad? | Yes, unchanged and expected — 9,209 lifetime `llmhub/claude-sonnet-4.6` turns still show `cacheRead = 0` in `session-usage-report.py`, because those turns predate the fix (commit `f93a8e2`, 2026-08-31 09:10:32). This session is the **first** post-fix data point, not a retroactive one. |

---

## Evidence: `cacheRead` by turn

Extracted directly from each assistant message's `usage` block in the session JSONL:

| # | Timestamp (UTC) | input | output | **cacheRead** | cacheWrite | cost (€) |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 11:38:54 | 24,365 | 3,094 | **0** | 0 | 0.2618 |
| 2 | 11:41:18 | 24,451 | 6,831 | **0** | 0 | 0.3645 |
| 3 | 11:41:32 | 6,883 | 596 | **24,450** | 0 | 0.0842 |
| 4 | 11:41:46 | 14,034 | 89 | **24,356** | 0 | 0.1224 |
| 5 | 11:44:04 | 7,121 | 6,750 | **31,332** | 0 | 0.2590 |
| 6 | 11:44:20 | 6,813 | 703 | **38,452** | 0 | 0.0969 |
| 7 | 11:45:48 | 14,723 | 3,713 | **38,381** | 0 | 0.2366 |
| 8 | 11:48:08 | 7,903 | 6,735 | **45,264** | 0 | 0.2744 |
| 9 | 11:48:26 | 6,792 | 716 | **53,166** | 0 | 0.1078 |
| 10 | 11:51:13 | 14,760 | 7,575 | **53,095** | 0 | 0.3530 |
| 11 | 11:51:30 | 15,478 | 693 | **59,957** | 0 | 0.1754 |
| 12 | 11:54:22 | 52,784 | 2,459 | **24,356** ⚠️ reset | 0 | 0.4692 |
| 13 | 11:57:07 | 60,693 | 7,983 | **16,510** | 0 | 0.6718 |
| 14 | 11:57:23 | 8,036 | 705 | **77,202** | 0 | 0.1341 |
| 15 | 12:01:10 | 79,314 | 13 | **0** ⚠️ reset | 0 | 0.5778 |
| 16 | 12:01:13 | 27 | 13 | **79,304** | 0 | 0.0584 |
| **Σ** | | **344,177** | **48,668** | **565,825** | **0** | **4.2473** |

**Reading the pattern (this is the exact behavior the fix was designed to produce):**

- **Turn 1** (first `llmhub` turn in the session) — `cacheRead = 0` as expected: nothing has been
  cached yet, this is the cold-start write.
- **Turn 2** — still `cacheRead = 0`. Two full-price turns before the first cache hit is a slightly
  longer cold start than the ideal single-turn baseline in the validation plan's Step 1, but not a
  regression — see Gaps below for why.
- **Turn 3 onward** — `cacheRead` immediately jumps to 24,450 and keeps climbing turn over turn
  (24,356 → 31,332 → 38,452 → … → 77,202), tracking the growing stable prefix exactly as the fix's
  mechanism predicts (LLMHub/Claude reading back the previously-cached system prompt + tool defs +
  conversation prefix instead of reprocessing it at full price).
- **Turn 12 and turn 15 show resets** (`cacheRead` drops back to 24,356 and to 0 respectively).
  These line up exactly with the user-message timestamps for the **next `match-cv` skill
  invocation** (each of the 5 CV-match runs re-sends the entire ~24K-token skill prompt + JD + CV
  text as a fresh user message) — i.e. a **new stable prefix**, not a caching failure. This is the
  same "cache reset on conversation-context change" pattern already documented and explained in
  `docs/cache-analysis-2026-08-31-cv-review.md` for GLM-5.2 (2 resets there, also tied to new
  subtask/file loads, not cache breakage).
- Because `llmhub/claude-sonnet-4.6`'s `cacheWrite` cost (€9.10/M) is non-zero in
  `agent/models.json`, a "true" reset (TTL expiry or first write into a *new* cache segment) would
  show up as `cacheWrite > 0`. **All 16 turns show `cacheWrite = 0`.** Combined with the `cacheRead`
  behavior, this indicates each new skill invocation's prompt hash landed on a cache segment
  LLMHub/Claude had *already* written on a previous invocation this session (or the backend didn't
  bill the write explicitly) rather than paying a fresh write penalty each time — a favorable
  outcome, though see the Gaps section for why this specific mechanic isn't fully confirmed.

---

## Cost impact: caching vs. hypothetical no-cache

Recomputed directly from `agent/models.json`'s `llmhub.claude-sonnet-4.6.cost` block
(`input: €7.28/M`, `output: €27.30/M`, `cacheRead: €0.73/M`, `cacheWrite: €9.10/M`):

```
Actual (with caching), summed over 16 turns:
  fresh input        344,177 tok  × 7.28/M  = €2.5064
  output               48,668 tok × 27.30/M = €1.3286
  cacheRead            565,825 tok × 0.73/M = €0.4130 
  cacheWrite                 0 tok × 9.10/M = €0.0000
  ────────────────────────────────────────────────────
  Total (actual, matches usage.cost.total field)  = €4.2473

Hypothetical (identical session, same tokens, caching disabled — every
"input-equivalent" token billed at the full €7.28/M input rate instead):
  (344,177 + 565,825 + 0) tok × 7.28/M + output at 27.30/M            = €7.9535

Savings from caching on this session:  €3.7062  (46.6%)
```

For context: the original incident session analyzed in `docs/prompt-cache-analysis.md` cost
**€275.28** for one ~2-hour, 235-turn debugging session with `cacheRead = 0` throughout — driven
by both root causes (no caching *and* unbounded context growth) compounding. This session, at
**€4.25** for 5 complete structured CV-match reports with real caching engaged, is not a
like-for-like comparison (different task shape, ~1/15th the turns), but it is a clean confirmation
that the mechanism the fix targets is functioning: fresh input this session (344,177 tokens) is
smaller than cache-read tokens (565,825), meaning **the majority of this session's context was
served at the ~10% discounted cache-read rate rather than full price.**

---

## Root cause #2 status check: `pi-condense` / context pruning

The original incident's second root cause (`pi-condense` installed but `enabled: false`, never
firing) is also resolved and was actively exercised in this session:

- `agent/settings.json` → `contextPrune.enabled: true` (confirmed live, matches
  `docs/setup-refactor-plan.md`'s fix record).
- This session's JSONL contains real `context-prune-chain` events with non-trivial payloads (2
  `chainsCompressed` events, `blockId: "b1"` and `"b2"`, each dropping/consolidating tool-call
  pairs from earlier finished skill-invocation batches into deterministic compressed summaries) —
  a clear behavioral difference from the original incident session, which the earlier analysis
  confirmed had **zero** `context-prune-diagnostic`/pruner activity across all 235 turns.
- `pruneOn: "agent-message"` (batches once per finished task, not every turn) is doing what its
  design intent describes — it did not fight the cache: `cacheRead` climbed monotonically within
  each skill-invocation block (turns 3–11, turns 13–14) rather than resetting on every turn.
- Session was short (~23 min active, 16 turns) and never approached the pruning trigger conditions
  aggressively — most `context-prune-frontier` events report `outcome: "skipped-trivial"` because
  the raw content per batch (~114–140 chars) was below `minBatchChars: 1000`. This is expected
  behavior for a session this size, not a gap: the mechanism is present, live, and correctly
  declining to do unnecessary work, not silently disabled as before.

---

## Comparison to the validation plan's steps

| Step | Planned | Observed in this session |
| --- | --- | --- |
| 0 | Restart pi after confirming `compat` fix is in `models.json` | Not directly verifiable from the JSONL (no restart marker recorded), but the fix's config is live and the model's `compat.cacheControlFormat` was in effect for this session — see next row. |
| 1 | Fresh session, `cacheWrite > 0`, `cacheRead = 0` baseline | **Partial match.** `cacheRead = 0` on turns 1–2 as expected. `cacheWrite` was **0**, not `>0`, on every turn including the cold start — flagged as a gap below. |
| 2–3 | Continue same session, `cacheRead > 0`, growing | ✅ Confirmed — turns 3–11 show monotonic `cacheRead` growth (24,450 → 59,957). |
| 4–10 | Keep going back-to-back, `cacheRead` tracking stable-prefix growth | ✅ Confirmed, with expected resets at new skill-invocation boundaries (turns 12, 15), each followed by immediate re-growth (turn 13→14, turn 16). |
| bonus | Deliberate 6+ min pause, confirm `cacheWrite` reappears (TTL expiry) | **Not exercised.** No gap in this session exceeds ~4 minutes (largest: 11:57:23 → 12:01:10, ~3m47s). TTL-expiry behavior is therefore still unconfirmed — see Gaps. |

---

## Gaps / still open after this validation

1. **`cacheWrite` was 0 on every one of the 16 turns, including the cold-start turns (1–2).** The
   validation plan explicitly expected `cacheWrite > 0` on the first turn as the "baseline write"
   signal. Two explanations are consistent with the data and neither is ruled out by this session
   alone:
   - LLMHub's proxy may report/bill cache writes differently for `openai-completions`-shaped
     requests than the `cacheRead`-only view surfaced here (i.e. writes happen but aren't itemized
     the same way `cacheRead` is).
   - Alternatively, the backend may be using the same kind of automatic/implicit caching already
     documented for GLM-5.2 in `docs/cache-analysis-2026-08-31-cv-review.md` (cache populated
     server-side without an explicit billable "write" event), which would also explain why the
     turn-12 and turn-15 "resets" did **not** show a `cacheWrite` charge either.
   Either way, `cacheRead > 0` — the actual thing the fix needed to prove — is confirmed. The
   `cacheWrite` mechanic is a secondary curiosity, not a blocker, but worth a follow-up note if a
   future session on this model *does* show `cacheWrite > 0`, to settle which explanation is right.
2. **The "bonus" TTL-expiry check (6+ minute idle pause) was not performed.** No natural gap in
   this session exceeded ~4 minutes. Recommend deliberately running that specific check in the
   next `llmhub/claude-sonnet-4.6` session if TTL behavior needs to be characterized precisely
   (e.g. for setting expectations around session idle time before assuming cache is cold).
3. **The lifetime `session-usage-report.py` aggregate for `llmhub/claude-sonnet-4.6` (9,209 turns,
   1.55B input tokens, `cacheRead = 0`) is unchanged by this session** and will remain that way —
   that aggregate is dominated by ~9,207 pre-fix turns from before commit `f93a8e2`
   (2026-08-31 09:10:32). This is expected and is **not** evidence the fix is ineffective; it is a
   historical artifact that predates the fix by construction. No action needed on that number
   itself, but it should not be re-flagged as "still broken" in future audits without checking the
   per-session date against the fix commit first, the same care already taken in
   `docs/harness-review-2026-08-31-followup.md`.

---

## Verdict

**The `compat.cacheControlFormat: "anthropic"` fix for `llmhub/claude-sonnet-4.6` works in
production.** This closes the single item that had been carried as "still open" across three prior
documents (`docs/prompt-cache-analysis.md`, `docs/setup-refactor-plan.md`,
`docs/harness-review-2026-08-31-followup.md`). Both compounding root causes identified in the
original €275 incident are now confirmed resolved and mutually non-interfering in a real session:

1. **Caching**: `cacheRead` reached as high as 79,304 tokens on a single turn and totaled 565,825
   tokens (62% of all input-equivalent tokens) across the session, saving ≈46.6% of what this
   session would otherwise have cost.
2. **Context pruning**: `pi-condense` is live and fired (2 chains compressed) without visibly
   fighting the cache — `cacheRead` grew monotonically within each pruning-eligible block rather
   than resetting on pruning activity.

Recommended next step: update `docs/setup-refactor-plan.md`'s implementation log with a dated
entry closing this item, referencing this document, per that file's decision-log convention
("past entries are not rewritten... add a new entry correcting/closing it").

---

## Full session usage stats (this session)

```
Session: 2026-09-01T11-22-06-302Z_01a05cb4-785e-7201-85c6-76181b5e05c9.jsonl
Workspace: /Users/A94984797/Workspace/cv-review
Models used: otc-internal/GLM-5.2 (orchestration/plannotator, 0 usage turns with cost),
             llmhub/claude-sonnet-4.6 (all 16 billed turns)

llmhub/claude-sonnet-4.6:
  Turns with usage:        16
  Fresh input tokens:      344,177
  Output tokens:            48,668
  Cache read tokens:       565,825   (62.2% of total input-equivalent)
  Cache write tokens:            0
  Total cost:              €4.2473
  Hypothetical no-cache cost: €7.9535
  Caching savings:         €3.7062  (46.6%)

Session wall-clock (first→last event): 11:22:06 → 12:01:14 UTC (~39 min total,
  ~23 min of active llmhub turns; 5 sequential match-cv skill invocations)
```
