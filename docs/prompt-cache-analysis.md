# Prompt Cache & Context-Growth Analysis — `claude-sonnet-4.6` via `llmhub`

> **Note added 2026-08-29 (Phase 1, `~/.pi/setup-refactor-plan.md`):** a live-config re-audit on
> this date found that the fixes this document analyzes/prescribes were **absent from the live
> `settings.json`/`models.json`** at the time of the original audit, contrary to what an earlier
> draft of this doc implied had already been applied. The fixes have since been implemented and
> are tracked in `~/.pi/setup-refactor-plan.md`'s Implementation log (config-level fix for
> `compat.cacheControlFormat`/cost applied; **live end-to-end cache verification is still
> outstanding**, blocked on the LLMHub project's monthly budget limit — see that plan's
> "Recommended next steps"). Treat this document as **analysis plus intended remediation**, not
> as current-state documentation of what's live. For authoritative LLMHub per-model pricing, see
> `~/.pi/llmhub-model-pricing.md` (added 2026-08-29), not the single-model figures cited inline below.

**Status: REVISED.** This supersedes the previous version of this file. The prior version got the
cost impact wrong (assumed the model was free) and only looked at one of two compounding root
causes. Both are corrected below with numbers re-derived directly from the session file.

## Session analyzed

```
File:     ~/.pi/agent/sessions/--Users-A94984797-Workspace-cv-review--/2026-08-14T12-26-19-904Z_01a0003c-cd80-709a-b3f7-52946063e6cb.jsonl
Model:    claude-sonnet-4.6
Provider: llmhub  (api: openai-completions, baseUrl: https://llm-server.llmhub.t-systems.net/v2)
Started:  2026-08-14T12:27:18Z
Ended:    2026-08-14T14:18:37Z   (~1h 51m)
Turns:    235 assistant messages, 488 lines total
Task:     "why can I not invoke .pi/extensions/match-cv/ with /match-cv" — a single debugging question
```

---

## TL;DR — what actually happened, corrected

| | Original doc claimed | **Corrected finding** |
|---|---|---|
| cacheRead / cacheWrite | 0 on all 235 turns | ✅ confirmed, still 0 on all 235 turns |
| Root cause | Missing `compat.cacheControlFormat: "anthropic"` (single cause) | ⚠️ **Two independent, compounding causes** (caching *and* context growth — see below) |
| Cost impact | "cost is 0, so savings are latency-only" | ❌ **Wrong.** LLMHub pricing sheet (pi-dev key, Digital Application Hub Prod) shows `claude-sonnet-4.6` at **€7.28 / M input, €27.30 / M output**. This session cost **≈ €275** in real terms, entirely avoidable. |
| Compaction | Flagged as a contributing factor ("rewrites history prefix and invalidates cache") | ❌ **Never fired.** Threshold is `contextWindow (1,000,000) − reserveTokens (16,384) = 983,616` tokens; session peaked at 297,667. Compaction was never in play. |
| Context pruning (`pi-condense`) | Not analyzed at all | 🔴 **New finding: installed but dormant the entire session.** See below. |

---

## Real cost, recalculated

```
Total input tokens (uncached, all 235 turns):  37,388,959
Total output tokens:                              113,110
cacheRead / cacheWrite:                                 0 / 0

LLMHub pricing (screenshot, "pi-dev" key, GCP/Standard tier):
  claude-sonnet-4.6  input: 7.28 €/M   output: 27.30 €/M

Cost = 37,388,959 / 1,000,000 × 7.28  +  113,110 / 1,000,000 × 27.30
     = 272.19 €              +          3.09 €
     = 275.28 €  for a single ~2-hour debugging session
```

For comparison, the API key's own dashboard shows **757,988,702 total tokens** processed against this
key project-wide in the reporting window — this one session alone accounts for ~4.9% of that lifetime
total, in under two hours, on a task that started as a one-line question.

---

## Root cause #1 (confirmed): zero prompt caching

pi's `openai-completions` driver only auto-detects Anthropic-style `cache_control` breakpoints for
one narrow case:

```js
// detectCompat()
const cacheControlFormat = provider === "openrouter" && model.id.startsWith("anthropic/")
                         ? "anthropic" : undefined;
```

`llmhub` is not `openrouter`, so `cacheControlFormat` stayed `undefined` for the entire session →
`getCompatCacheControl()` returned nothing → no `cache_control` breakpoints were ever attached to
the system prompt, tool definitions, or conversation history → LLMHub's Claude backend never wrote
or read from its ephemeral cache → **every one of the 235 turns paid full price for the entire
growing prompt.**

**Fix already applied** (before this re-analysis) to `~/.pi/agent/models.json`:

```json
"llmhub": {
  "models": [
    {
      "id": "claude-sonnet-4.6",
      ...
      "compat": { "cacheControlFormat": "anthropic" }
    }
  ]
}
```

This makes pi attach `"cache_control": {"type": "ephemeral"}` to three breakpoints per request
(system prompt, last tool, last conversation message) — the exact wire format LLMHub's
[prefix-caching guide](https://docs.llmhub.t-systems.net/guides/prefix-caching/) documents.

**Still open:**
- Whether the LLMHub gateway actually **forwards** `cache_control` to the real Claude backend (vs.
  silently stripping it) has **not been verified with a live request** yet. See Verification section.

---

## Root cause #2 (new): unbounded context growth — `pi-condense` was installed but never turned on

This is the part the original analysis missed entirely, and it's arguably the bigger structural
problem because it compounds #1 rather than standing alone.

### What the session actually did

```
Turn   1: input =   2,871 tokens
Turn  50: input =  77,702 tokens
Turn 100: input = 139,716 tokens
Turn 150: input = 204,599 tokens
Turn 200: input = 243,306 tokens
Turn 235: input = 297,667 tokens   (last turn)
```

Tool call breakdown for this session:
```
bash   : 123 calls
read   :  44 calls  →  ~57,500 tokens of raw file content returned into context
edit   :  40 calls
write  :  19 calls
web_*  :   6 calls  →  ~36,000 tokens of raw bash output returned into context
```

Every one of those tool results (raw `bash` stdout, full `read` file contents, etc.) stayed in the
conversation **verbatim, forever**, because nothing was pruning or summarizing finished work. The
prompt grew monotonically from 2.8K to 297.7K tokens over the session and was **never** cut back
down — each new turn re-sent the *entire* accumulated history as fresh input.

### Why pi's built-in compaction didn't help here

Compaction (`~/.pi/agent/settings.json` → `compaction: {enabled: true, reserveTokens: 16384,
keepRecentTokens: 20000}`) only fires when:

```js
shouldCompact(contextTokens, contextWindow, settings) {
  return contextTokens > contextWindow - settings.reserveTokens;   // 1,000,000 - 16,384 = 983,616
}
```

The session peaked at 297,667 tokens — **less than a third** of the 983,616-token trigger point.
Compaction is a *last-resort* safety net for approaching the context window limit; it is not, and
was never meant to be, a cost-control mechanism for a 300K-token session. It never engaged here, so
it is **not implicated** in this incident, contrary to the earlier draft's speculation.

### The actual gap: `pi-condense` was present but inert

`~/.pi/agent/settings.json` declares:

```json
"packages": ["npm:pi-condense"]
```

`pi-condense` is installed and loaded as an extension. But its own internal switch is **off by
default**, and turning it on requires either running `/pruner on` in a session or adding a
`contextPrune` block to `settings.json`:

```js
// pi-condense/src/types.ts
export const DEFAULT_CONFIG: ContextPruneConfig = {
  enabled: false,   // ← off unless explicitly turned on
  ...
};
```

`~/.pi/agent/settings.json` has **no `contextPrune` key at all** → the default (`enabled: false`)
applied for the entire session. Confirmed independently: the session file contains **zero**
`context-prune-diagnostic` entries and no `"Summarized in pruner summary"` stubs — the pruner never
ran a single time in this 235-turn session.

This means the tool responsible for exactly this problem — "long agent sessions accumulate raw tool
output that inflates the cost of every subsequent request" (pi-condense's own README) — was sitting
on the shelf, installed, doing nothing.

### Why this compounds root cause #1

pi-condense's own documentation makes the interaction explicit:

> "Provider prompt-caching does not fix \[context growth] on its own: naive trimming actively fights
> it, because rewriting the prompt on every turn busts the cache you were relying on to keep costs
> down."

In this session both protections were absent simultaneously — the worst-case combination:

- No caching → every turn paid full price for the *entire* prompt, not just the new tokens.
- No pruning → the prompt itself grew without bound, so "full price for the entire prompt" kept
  getting bigger, turn after turn, for almost two hours.

Either fix alone would have helped. Both together are what actually contain cost on long sessions:
caching keeps the *stable* prefix cheap to re-read, pruning keeps that prefix from growing forever
in the first place — and pi-condense is specifically designed to batch its rewrites so it doesn't
fight the cache (`pruneOn: "agent-message"`, fires once per finished task batch, not every turn).

---

## Combined root cause statement

> A ~2 hour, 235-turn debugging session on `claude-sonnet-4.6` via the `llmhub` provider cost
> approximately **€275** and reprocessed **37.4M input tokens** with **zero** cache reuse, because
> (1) the `llmhub` model entry in `models.json` was missing the `compat.cacheControlFormat:
> "anthropic"` flag required for pi to emit Anthropic `cache_control` breakpoints, and (2) the
> `pi-condense` context-pruning package, although installed, was never enabled, so raw tool output
> (file reads, bash output, edits) accumulated unbounded in the conversation history instead of
> being periodically summarized. Neither issue is a pi code defect — both are configuration gaps
> with documented, available fixes.

---

## Fixes: applied vs. still outstanding

### ✅ Applied

**1. Caching flag** — `~/.pi/agent/models.json` → `llmhub.models[].claude-sonnet-4.6`:
```json
"compat": { "cacheControlFormat": "anthropic" }
```

**2. `pi-condense` enabled globally** — `~/.pi/agent/settings.json`:
```json
"contextPrune": {
  "enabled": true,
  "pruneOn": "agent-message",
  "summarizerModel": "otc-internal/gpt-oss-120b"
}
```

This is a **global, agent-wide setting** — it is not and cannot be scoped to a specific model or
provider. `contextPrune` sits at the top level of `settings.json` next to `compaction` and `retry`,
and pi-condense's own source has no per-model/per-provider filter in its config schema. Enabling it
turns pruning on for **every session run from this pi config, on any model or provider** —
`claude-sonnet-4.6` via `llmhub`, but equally `gpt-oss-120b` via `otc-internal`, OpenRouter models,
or anything else selected going forward.

The only per-model knob available is `summarizerModel`, which controls *which model performs the
summarization work*, not *which sessions get pruned*. It was pointed at `otc-internal/gpt-oss-120b`
(zero-cost internal endpoint per `models.json`) specifically so pruning itself adds no additional
token cost, and so the expensive `claude-sonnet-4.6` driver model is never used to summarize its own
history.

If a narrower, per-model rollout is ever wanted instead, the only supported mechanism is manual:
typing `/pruner on` / `/pruner off` at the start/end of specific sessions. There is no config-level
way to restrict it to "only when driving with sonnet-4.6."

### 🔲 Outstanding — recommended actions

**1. Verify the gateway actually forwards `cache_control`** (not yet confirmed):

```bash
NEW=$(ls -t ~/.pi/agent/sessions/--Users-A94984797-Workspace-cv-review--/*.jsonl | head -1)
python3 - "$NEW" <<'PY'
import sys, json
for line in open(sys.argv[1]):
    line = line.strip()
    if not line: continue
    o = json.loads(line)
    if o.get("type") != "message": continue
    m = o.get("message", {})
    u = m.get("usage", {}) if isinstance(m, dict) else {}
    if isinstance(u, dict) and "cacheRead" in u:
        print(f"in={u.get('input'):>6} cr={u.get('cacheRead'):>6} cw={u.get('cacheWrite'):>6} stop={m.get('stopReason')}")
PY
```
Expect `cacheWrite > 0` on turn 1 (or after any 5-min gap), `cacheRead` growing on later turns.
If instead you get an HTTP 400 / "unknown field", roll back with the script in the previous
version of this doc (remove the `compat` block).

**2. Confirm the pruner is actually active on the next session:**

```bash
/pruner status    # expect: enabled=true, mode=agent-message, model=otc-internal/gpt-oss-120b
```

This bounds context growth going forward without fighting the cache — pruning fires once per
finished tool-call batch, not per turn, which is exactly the batching discipline the LLMHub docs'
best practices call for ("append, never rewrite; batch related calls together").

**3. Optional — tighten `compaction` as a pure safety net, not the primary control.**
Current settings (`reserveTokens: 16384`, `keepRecentTokens: 20000`) are fine to leave as-is now
that pi-condense is the primary mechanism keeping sessions well under the compaction threshold.
No change strictly required here; compaction was never the problem in this session.

**4. Process note, not a config change:** this session ran ~2 hours and 235 turns on what began as
a single debugging question ("why can't I invoke `/match-cv`"). Consider splitting long
investigative/debugging threads into fresh sessions once the original question is answered, rather
than continuing to accumulate one very long thread — pi-condense reduces the cost of doing so, but
starting a new session for a genuinely new task is still the cheapest option of all.

---

## What to tell people who ask "what went wrong and what's being done about it"

- **What went wrong:** two independent config gaps — Anthropic prompt caching was never enabled for
  this provider/model combination, and the context-pruning package we already have installed
  (`pi-condense`) was never switched on. Together they meant a long debugging session reprocessed
  its entire, ever-growing history from scratch on every turn, at full listed price, for about two
  hours — roughly €275 for one session.
- **Is this a pi bug?** No. pi provides both mechanisms (the `compat.cacheControlFormat` override and
  the `pi-condense` extension) precisely for this; neither was configured/enabled for this provider.
- **What's fixed:** `claude-sonnet-4.6` on `llmhub` now has the caching flag set, **and**
  `pi-condense` is now enabled **globally** in `~/.pi/agent/settings.json` — this applies to every
  session on every model/provider, not just `sonnet-4.6`, since pi-condense has no per-model scoping
  mechanism.
- **What's still needed:** verify with a live session that the LLMHub gateway forwards
  `cache_control` end-to-end, and confirm `/pruner status` shows the pruner active on the next
  session.

---

## Root cause #3 (new, applied): every model's cost was hardcoded to zero — no spend was ever visible

While re-checking `~/.pi/agent/models.json` against the LLMHub docs and pricing page, a third,
fleet-wide gap was found — bigger in scope than the two above, because it affects **every provider
and every model**, not just `claude-sonnet-4.6`.

### The gap

```jsonc
// Every single manually-configured model, before this fix:
"cost": { "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0 }
```

pi's footer, `/session` cost summary, and running totals all read directly from `model.cost`. With
every entry hardcoded to `0`, **the agent had no real-time cost signal at all** — the €275 spend
from the session above was invisible in the UI the entire ~2 hours it was happening, not merely
under-cached.

Cross-checking against pi's own auto-fetched catalog (`models-store.json`, populated from live
OpenRouter data) proved this was wrong, not a deliberate "free tier" setting:

| Source | Model | input / output (per M tokens) |
|---|---|---|
| `models.json` (manual, before fix) | `openrouter/anthropic/claude-sonnet-4.6` | €0 / €0 |
| `models-store.json` (auto-fetched, real OpenRouter pricing) | `anthropic/claude-sonnet-4.6` | $3 / $15 |

Same model, same provider family — one source said free, the other said real money. The manual
config was simply never filled in.

### What was confirmed and fixed

Source of truth used: LLMHub's [Plans & Pricing](https://docs.llmhub.t-systems.net/plans) page
(T-Cloud Standard tier: **€0.20 input / €0.65 output per M tokens**, applies to all rate plans) for
the `otc-internal` provider, the pricing figure quoted from the pi-dev key's own billing screenshot
for `claude-sonnet-4.6` on `llmhub` (**€7.28 / €27.30 per M**, cache read/write estimated at 10%/25%
of input per Anthropic's standard cache-pricing ratio), and pi's own `models-store.json` for
OpenRouter-hosted models (real, auto-fetched rates).

```jsonc
// ~/.pi/agent/models.json — applied
otc-internal: Llama-3.3-70B-Instruct, gpt-oss-120b, GLM-5.2
  → "cost": { "input": 0.20, "output": 0.65, "cacheRead": 0, "cacheWrite": 0 }

llmhub: claude-sonnet-4.6
  → "cost": { "input": 7.28, "output": 27.30, "cacheRead": 0.73, "cacheWrite": 9.10 }

llmhub: Qwen2.5-Coder-7B-Base
  → "cost": { "input": 0.20, "output": 0.65, "cacheRead": 0, "cacheWrite": 0 }   # T-Cloud Standard tier

openrouter: openrouter/anthropic/claude-sonnet-4.6
  → "cost": { "input": 3, "output": 15, "cacheRead": 0.3, "cacheWrite": 3.75 }

openrouter: moonshotai/kimi-k2.6
  → "cost": { "input": 0.95, "output": 4, "cacheRead": 0.16, "cacheWrite": 0 }
```

**Left at `0` and explicitly flagged**, rather than guessed, because no reliable pricing source could
be confirmed for these (each now carries an `_costNote` field in `models.json` explaining why and
where to verify):

- `llmhub: claude-opus-4.8`, `gemini-2.5-pro`, `gpt-5` — LLMHub's per-model pricing table on the
  [Plans & Pricing](https://docs.llmhub.t-systems.net/plans) page is rendered client-side via JS and
  returned "Showing 0 of 0 models" on fetch; the Premium-tier per-model rates were not retrievable
  this way. Verify via the [API Key self-serve portal](https://apikey.llmhub.t-systems.net/login) or
  a recent invoice.
- `ai-engineer: Claude 4 (Sonnet)` — internal gateway (`aie-strive.devops.t-systems.net`), no public
  pricing page found at all. Verify with the team operating that endpoint.

### Fix applied

1. `~/.pi/agent/models.json` — populated real `cost` values for every model where a source could be
   confirmed (10 of 13 model entries); left `0` with an explanatory `_costNote` for the remaining 3
   where pricing could not be independently verified.
2. `~/.pi/agent/settings.json` — added:
   ```json
   "showCacheMissNotices": true
   ```
   This is a built-in pi setting (previously `false`, the default) that prints a visible transcript
   notice on significant prompt-cache misses and on compaction/branch-summary token usage. Had this
   been on already, the 235-turn session would have surfaced a warning on essentially every turn
   instead of the failure only being caught in a post-mortem. This is the cheapest possible
   structural fix — one boolean, zero cost, immediate feedback loop — and is now on globally for all
   sessions.

### Why this matters more than root causes #1 and #2

Root causes #1 (no caching) and #2 (no pruning) explain *why* the session was expensive. Root cause
#3 explains why **nobody could have noticed while it was happening** — the one signal that would
have surfaced the problem in real time (the cost/token footer) was itself silently broken across
the entire model fleet, not just for `claude-sonnet-4.6`. Fixing #1 and #2 reduces future spend;
fixing #3 restores the ability to *see* spend at all, on every model, going forward.

### Outstanding follow-up

- Confirm the 3 remaining `_costNote`-flagged entries (`claude-opus-4.8`, `gemini-2.5-pro`, `gpt-5`
  on `llmhub`; `Claude 4 (Sonnet)` on `ai-engineer`) against the billing portal/invoice and fill in
  real numbers.
- Re-verify LLMHub's rate-limit vs. spend-limit distinction: per the
  [Rate Limits](https://docs.llmhub.t-systems.net/reference/rate-limits/) and
  [Plans & Pricing](https://docs.llmhub.t-systems.net/plans) pages, RPM/TPM ceilings are explicitly
  **best-effort, not part of the SLA**, and there is **no platform-side budget/spend-limit or
  alerting mechanism documented** — cost control is entirely the client's responsibility. The two
  fixes above (accurate `cost` fields + `showCacheMissNotices`) are currently the only lines of
  defense; there is no server-side backstop if a future session runs away regardless.
- `GLM-5.2` (now the `defaultModel` on `otc-internal`, replacing `claude-sonnet-4.6`/`llmhub` as
  default) is a T-Cloud open-source model. Per the prefix-caching guide, this family uses
  `save_cache` / `cache_salt` request-body fields, not `cache_control` — and pi has **no support for
  either field anywhere in its codebase** (confirmed by source grep). Whether T-Cloud caches this
  model's prefixes automatically server-side regardless is unconfirmed. Worth checking
  `usage.prompt_tokens_details.cached_tokens` on a live `GLM-5.2` session before assuming caching
  works there by default.

  **Update:** checked directly against session logs. pi does not use the raw OpenAI field name —
  it translates usage into `message.usage.cacheRead` per assistant turn in the session `.jsonl`.
  A live `GLM-5.2` / `otc-internal` session showed `cacheRead: 8320` on one turn (input 16,204) and
  `cacheRead: 0` on three others in the same session — so **T-Cloud does cache GLM-5.2 automatically,
  server-side, without pi ever sending `save_cache`/`cache_salt`**, but inconsistently (likely due to
  the ~1000-token minimum prefix and/or short cache TTL not always being met). Not a blocking issue,
  but caching for this model family is opportunistic rather than guaranteed the way `cache_control`
  breakpoints are for Claude.

---

## Root cause #4 considered and reverted: in-session cost/token status line

A global extension (`~/.pi/agent/extensions/cost-tracker.ts`) hooking `message_end` was built and
briefly added to print a per-turn + session-cumulative cost/token status line after every response,
in the same visual style as `obsidian-sync`'s footer notice.

**Removed at user's request** — the end-of-response usage summary was judged too noisy for regular
use. No files remain from this attempt; `~/.pi/agent/extensions/cost-tracker.ts` was deleted.

For ad-hoc cost checks going forward, use the manual approach validated earlier in this document:
read `message.usage` (`input`/`output`/`cacheRead`/`cacheWrite`/`totalTokens`/`cost`) directly from
the relevant session `.jsonl` under `~/.pi/agent/sessions/<workspace>/`, cross-referenced against
current rates in `models.json` (see the worked per-model cost breakdown table produced earlier for
the `2026-08-28T06-10-15...` session as a template). If persistent, low-noise visibility is wanted
again later, revisit this as an opt-in `/cost` command only (no automatic status line).

---

## Root cause #5 fixed: `openrouter/anthropic/claude-sonnet-5` missing from `models.json`

The manual cost check above surfaced a real, live gap: **87 of 101 turns** in the
`2026-08-28T06-10-15...` session ran on `openrouter/anthropic/claude-sonnet-5`, but that model had
**no entry at all** in `~/.pi/agent/models.json`'s `openrouter.models[]` — only `claude-sonnet-4.6`
was configured. Every request against `claude-sonnet-5` was therefore priced at €0 by pi, the same
failure mode as root cause #3, just on a model that hadn't been added yet rather than one that was
present-but-zeroed.

**Fix applied** — added the missing entry, sourced from pi's own auto-fetched
`~/.pi/agent/models-store.json` (`openrouter.models[] → anthropic/claude-sonnet-5`), which already
carries authoritative cost and compat data:

```json
{
  "id": "openrouter/anthropic/claude-sonnet-5",
  "name": "Claude Sonnet 5 (OpenRouter)",
  "reasoning": true,
  "input": ["text", "image"],
  "contextWindow": 1000000,
  "maxTokens": 128000,
  "cost": { "input": 2, "output": 10, "cacheRead": 0.2, "cacheWrite": 2.5 },
  "compat": { "thinkingFormat": "openrouter", "cacheControlFormat": "anthropic" }
}
```

Recomputing the same session's cost with this entry in place (see the per-model breakdown worked
out in the session status check) raised the true total from an under-reported **€0.43** (at the
time, with `claude-sonnet-5` silently at €0) to the corrected **€5.22** — the great majority of
which (€4.75) was `claude-sonnet-5` turns that had been invisible until this fix.

**Bonus finding:** the store data for `claude-sonnet-5` includes `compat.cacheControlFormat:
"anthropic"`, but the existing `claude-sonnet-4.6` entry on the *same* `openrouter` provider does
**not** have this flag set. Same root cause as #1/#2, third occurrence: without it, pi never
attaches `cache_control` breakpoints for that model, so `claude-sonnet-4.6` via OpenRouter likely
gets zero caching today. Not yet fixed — flagged here for a follow-up one-line addition, same as
the `claude-opus-4.8` fix pattern used earlier (minus the opus-specific scoping, since this report
is Claude-family-wide per the user's correction).

**Process takeaway:** `models-store.json` is the single most reliable source of truth for adding new
models correctly the first time — it already contains `cost` *and* `compat` fields pi needs, sourced
from the provider's own model listing. Any time a new model id shows up in a session log that isn't
in `models.json`, check `models-store.json` first before hand-writing an entry.
