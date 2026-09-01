# Session Caching Analysis Report — `cv-review` workspace, 2026-08-31

> **Scope:** all 6 sessions recorded on 2026-08-31 under
> `~/.pi/agent/sessions/--Users-A94984797-Workspace-cv-review--/`, with the requested session
> `2026-08-31T07-27-05-471Z_01a056b6-f2ff-77a7-bbbd-61215d568723.jsonl` analyzed in detail.
>
> **Question asked:** is prompt caching working? The user observed ~10M input tokens across the
> day's sessions and wanted to know whether caching was actually engaging or whether all that
> input was being reprocessed at full price.

---

## TL;DR — Yes, caching is working. Very well

Caching is functioning correctly across **all** Aug 31 `cv-review` sessions. The large "input
token" counts you're seeing are dominated by **cache reads** (discounted/free tokens), not fresh
processing. Caching saved an estimated **$105.23 (84.1%)** across the 6 sessions.

- Overall cache read rate: **96.0%** of all input-equivalent tokens were served from cache.
- Only **1.1%** (737,673 tokens) of the ~69M "input tokens" were actually fresh, full-price tokens.
- The rest — 66.1M cache reads + 2.0M cache writes — were served at a steep discount or for free.

---

## 1. The Requested Session: `07-27-05…01a056b6`

| Metric | Value |
| --- | --- |
| Model | `otc-internal/GLM-5.2` (entire session) |
| Turns with usage | 30 |
| Fresh input tokens | 182,935 (13.4%) |
| **Cache read tokens** | **1,183,744 (86.6%)** |
| Cache write tokens | 0 (always — see below) |
| Output tokens | 37,415 |
| **Cache read rate** | **86.6%** ✅ |
| Actual cost | $0.061 |

**Verdict: caching is working.** The cache builds progressively turn-by-turn:

```text
Turn 1:  cacheRead =     704   (just starting)
Turn 4:  cacheRead =  71,168   (cache warming up)
Turn 5:  cacheRead =  99,200   (peak — nearly entire context cached)
Turn 6:  cacheRead =  99,392   (99.6% cache hit)
```

**Cache resets detected: 2** (turns 7 and 14) — both caused by conversation context changes (new
subtasks/file loads), not cache failures. After each reset, the cache quickly rebuilds within 1–2
turns.

### Why `cacheWrite = 0` is NOT a problem

GLM-5.2 uses **implicit/automatic caching** — it caches the prompt prefix automatically without
emitting explicit "cache write" tokens. The proof is in the `cacheRead` values: if caching weren't
working, `cacheRead` would be 0. Instead it's 86.6% of all input. Additionally, **GLM cache reads are
completely free** ($0.00/tok), so those 1.18M cached tokens cost nothing.

This matches the finding already documented in `docs/prompt-cache-analysis.md` (root cause #3
update): T-Cloud caches GLM-5.2 automatically, server-side, without pi ever sending
`save_cache`/`cache_salt` fields. The 86.6% hit rate here is the best evidence yet that this
opportunistic server-side caching is consistently effective within a session.

---

## 2. All 6 Aug 31 Sessions — Combined View

| Session | Model(s) | Turns | Fresh In | Cache Read | Cache Write | Cache% | Cost |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `07-17` | GLM-5.2 | 39 | 160,577 | 1,723,648 | 0 | 91.5% | $0.056 |
| **`07-27`** | **GLM-5.2** | **30** | **182,935** | **1,183,744** | **0** | **86.6%** | **$0.061** |
| `11-40` | GLM-5.2 → **Claude S5** | 124 | 205,704 | 17,067,228 | 306,625 | 97.1% | $3.941 |
| `13-04` | GLM-5.2 → **Claude S5** | 329 | 658 | 44,700,277 | 1,682,681 | 96.4% | $15.757 |
| `15-40` | GLM-5.2 | 19 | 37,236 | 715,776 | 0 | 95.1% | $0.030 |
| `15-57` | GLM-5.2 | 21 | 150,563 | 744,256 | 0 | 83.2% | $0.065 |
| **TOTAL** | | **562** | **737,673** | **66,134,929** | **1,989,306** | **96.0%** | **$19.91** |

### Cost savings from caching

| | With caching (actual) | Without caching (hypothetical) | Savings |
| --- | --- | --- | --- |
| GLM-5.2 (4 sessions) | $0.32 | $1.92 | **$1.60 (83.5%)** |
| Claude Sonnet 5 (2 sessions) | $19.59 | $123.23 | **$103.63 (84.1%)** |
| **Combined** | **$19.91** | **$125.14** | **$105.23 (84.1%)** |

Pricing used (per million tokens), derived from the session cost records and `models.json`:

| Model | Input | Cache Read | Cache Write | Output |
| --- | --- | --- | --- | --- |
| GLM-5.2 (`otc-internal`) | $0.20 | $0.00 (free) | $0.00 | $0.65 |
| Claude Sonnet 5 (`openrouter`) | $2.00 | $0.20 | $2.50 | $10.00 |

---

## 3. Explaining the "~10M input token" observation — CONFIRMED against the dashboard chart

A follow-up dashboard screenshot ("Total/Input/Output Token Usage — GLM-5.2", daily bars
2026-08-25 → 2026-09-01) shows the 2026-08-31 bar at:

- **Input Token Usage: ~8.7–9M**
- **Total Token Usage: ~9–9.5M**

both **filtered to GLM-5.2 only** (not the combined 6-session/2-model total this doc used
elsewhere). Re-running the raw `.jsonl` numbers filtered the same way reconciles exactly:

| Session | Turns (GLM) | Fresh in | Cache read | Input-equiv |
| --- | --- | --- | --- | --- |
| `07-17` | 39 | 160,577 | 1,723,648 | 1,884,225 |
| `07-27` | 30 | 182,935 | 1,183,744 | 1,366,679 |
| `11-40` | 59 | 205,213 | 3,641,088 | 3,846,301 |
| `13-04` | 0 | 0 | 0 | 0 (session switched to Claude before any GLM usage was recorded) |
| `15-40` | 19 | 37,236 | 715,776 | 753,012 |
| `15-57` | 21 | 150,563 | 744,256 | 894,819 |
| **GLM-5.2 total, 08-31** | **168** | **736,524** | **8,008,512** | **8,745,036 (8.75M)** |

```text
GLM-5.2 "Input Token Usage" bar for 08-31 (chart) ≈ 8.7-9M
GLM-5.2 input-equivalent from raw sessions        = 8,745,036 (8.75M)   ← matches

GLM-5.2 "Total Token Usage" bar for 08-31 (chart) ≈ 9-9.5M
GLM-5.2 input-equivalent + output from raw sessions = 8,745,036 + 258,559
                                                     = 9,003,595 (9.00M) ← matches
```

**This confirms exactly where the ~10M comes from:** the dashboard's "Input Token Usage" metric
for GLM-5.2 sums `input + cacheRead` (and "Total Token Usage" additionally adds `output`) — it does
**not** net out cache hits into a separate bucket. Of that 8.75M GLM-5.2 input-equivalent on 08-31:

- **91.6% (8,008,512 tokens) is `cacheRead`** — free tokens, not fresh processing.
- Only **8.4% (736,524 tokens) is truly fresh input**, billed at $0.20/M.
- `cacheWrite` is 0 throughout, consistent with GLM's implicit/automatic caching (Section 4).

So the chart's big Aug-31 bar is not evidence of a caching regression — it is exactly the expected
shape for a heavy day of GLM-5.2 usage where caching is working well: a large "input tokens" total
that is 9-in-10 cache reads costing effectively nothing.

**Correction vs. the model-mix table in Section 2:** the `13-04` session is listed there as
"GLM-5.2 → Claude Sonnet 5" because a `model_change` record to GLM-5.2 appears in the file, but no
GLM-5.2 *usage* record follows it before the switch to Claude — that session's GLM-5.2 contribution
to token/cost totals is 0, and it is 100% Claude Sonnet 5 in practice.

### Prior working theory (combined across both models) — kept for reference

Before the chart was available, this doc estimated the same phenomenon across **all 6 sessions and
both models** (GLM-5.2 + Claude Sonnet 5 combined), which is a different, larger denominator:

```text
Total "input" tokens across ALL sessions/models (not just GLM-5.2):   68.86M
  ├── Cache reads (96.0%):  66.13M  ← FREE (GLM) or 90% off (Claude)
  ├── Cache writes (2.9%):   1.99M  ← 25% surcharge (Claude only)
  └── Fresh input (1.1%):    0.74M  ← full price, truly "new" processing
```

That combined total is real and the savings math in Section 2 still holds, but it is **not** the
figure behind the ~10M dashboard observation — the chart confirms the ~10M is the GLM-5.2-only
input/total token bar, reconciled above.

If you're specifically seeing ~10M (rather than ~69M), that may be a per-session view or a specific
metric subset — but regardless, the caching mechanism is confirmed healthy.

---

## 4. Model-Specific Caching Behavior

### GLM-5.2 (`otc-internal`) — 4 of 6 sessions

- **Implicit caching:** `cacheWrite` is always 0. The model caches automatically — no explicit
  cache-write tokens are emitted.
- **Cache reads are FREE:** $0.00/token. Cached tokens cost nothing.
- Cache read rate: 83–95% across sessions.
- No cache TTL resets observed (GLM cache appears to persist within a session).

### Claude Sonnet 5 (`openrouter`) — 2 of 6 sessions

- **Explicit caching:** `cacheWrite` > 0 (2–4% of input). Each turn writes new content to cache.
- **Cache read pricing:** $0.20/M tokens (90% discount vs. $2.00/M fresh input).
- Cache read rate: 96–98% (excellent).
- **7 cache resets** in the 329-turn session (`13-04`):
  - 5 caused by context/prefix changes (new files, subtask switches) — gaps were 0.8–3.2 min
  - 2 caused by cache TTL expiry (idle gaps >5 min: 14.4 min and 31.1 min)
  - Each reset triggers a `cacheWrite` burst (76K–174K tokens) to rebuild the cache — this is
    normal and expected behavior.

#### Cache reset detail (the 329-turn Claude session)

```text
turn  timestamp              cacheRead (prev -> new)   cacheWrite   gap
 10  13:14:07  cacheRead  50,462 ->  18,773   cacheWrite= 10,933   gap= 3.2min
 48  14:06:53  cacheRead 172,155 ->  18,773   cacheWrite= 86,958   gap= 2.3min
 71  14:21:27  cacheRead 107,456 ->       0   cacheWrite=108,522   gap=14.4min  ← TTL expiry
 86  14:31:10  cacheRead 121,030 ->       0   cacheWrite= 98,714   gap= 7.2min  ← TTL expiry
 92  14:36:31  cacheRead 106,405 ->  18,773   cacheWrite= 76,273   gap= 1.1min
127  15:03:34  cacheRead 235,880 ->  14,972   cacheWrite=111,545   gap= 0.8min
187  15:38:19  cacheRead 149,542 ->       0   cacheWrite=174,443   gap=31.1min  ← TTL expiry
```

Time gap distribution between consecutive Claude turns (329 turns total):

```text
median gap = 0.11 min    max gap = 31.1 min    mean = 0.47 min
gaps > 5 min (cache TTL): 3 (0.9%)   ← largest: 31.1, 14.4, 7.2 min
```

The vast majority of turns (99.1%) are within Claude's ~5 min cache TTL, so resets are rare and the
cache read rate stays high (96.4%) even over a 329-turn session.

---

## 5. Recommendations

1. **No action needed** — caching is healthy and saving 84% on input costs.
2. If you want to reduce the 7 cache resets in long Claude sessions, try to **minimize idle gaps
   >5 min** (Claude's cache TTL) and avoid switching file/subtask context mid-session where
   possible.
3. The two Claude sessions account for **$19.59 of the $19.91 total cost** (98.5%). If cost is a
   concern, the GLM-5.2 sessions are effectively free ($0.003–0.061 each). The cost driver is the
   Claude Sonnet 5 usage, particularly the 329-turn session at $15.76.
4. The `cacheWrite = 0` on GLM-5.2 is expected behavior (implicit caching), **not** a bug or
   missing feature.
5. If the dashboard view that showed "~10M" is counting cache reads as input, consider whether
   surfacing a separate "fresh input vs. cached" breakdown would be less alarming — the current
   conflation makes caching *look* expensive when it's actually the thing keeping costs down.

---

## Methodology

All figures derived directly from the session `.jsonl` files under
`~/.pi/agent/sessions/--Users-A94984797-Workspace-cv-review--/`. Each assistant `message` record
contains a `usage` object with `input`, `output`, `cacheRead`, `cacheWrite`, `reasoning`,
`totalTokens`, and a nested `cost` object. The current model at each turn was determined from
`model_change` records interleaved with the messages. Per-token pricing was reverse-engineered from
the recorded `cost` fields (e.g. a GLM-5.2 turn with `input: 9249, cost.input: $0.0018498` →
$0.20/M) and cross-checked against `~/.pi/agent/models.json`. Hypothetical "without caching" cost
was computed by repricing all cache-read and cache-write tokens at the full input rate.
