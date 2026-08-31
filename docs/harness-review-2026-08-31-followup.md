# ~/.pi harness follow-up review — 2026-08-31 (later same day)

Re-inspection of the config home after the `docs/` reorg and SearXNG
fix, following up on `docs/harness-review-2026-08-31.md`. Scope: confirm
nothing regressed from the file moves, check for newly-noticed
untracked/secret material, and re-check the original review's open
checklist items.

## 1. Critical findings

### None new. No secrets, no regressions from the `docs/` move

- `git status --short` clean of `auth.json` / `*-store.json` /
  `sessions/` / `.bak`; only the expected `docs/` renames + comment-path
  updates + doc content edits are staged/modified.
- `git grep` for API-key/secret/token/password-style literal assignments
  across tracked files returned **zero hits** outside the
  `!security find-generic-password` reference pattern — no raw
  credential leaked into a tracked file.
- No `.env`, `*token*`, `*secret*`, or `*credential*`-named file is
  tracked in git (`git ls-files` check).

### 🟡 Untracked `~/.pi/.pi/` directory (78 MB) — not a secret, but undocumented and not gitignored

Found via `git status`. This is **not** the `agent/.pi/` directory
(which holds `{"packages": []}` and is tracked) — it's a second,
separate `.pi/` at the repo root, containing `settings.json`
(`{"packages": ["npm:pi-mcp-adapter"]}`), a `cache/` dir (web-fetch
cache + `.DS_Store`), and a full `npm/node_modules` install (ajv, jose,
cross-spawn, etc. — the `pi-mcp-adapter` extension's own dependency
tree). This looks like a **pi-managed runtime artifact** (an MCP
adapter's installed package cache), analogous to the already-gitignored
`agent/npm/` and `agent/.pi/npm/` — but the top-level `.pi/` path itself
has no `.gitignore` entry, so `git status` will flag it (and everything
under it) on every future run in this repo until it's excluded.

**Not fixed this session — flagging only**, since it's ambiguous whether
this is the intended location (vs. a duplicate that should live under
`agent/`) and getting the `.gitignore` pattern right (e.g. `/.pi/` vs
`.pi/` — the latter would also match `agent/.pi/`, which currently *is*
tracked with real content and must stay tracked) needs a deliberate
decision, not a blind pattern add.

### 🟢 Telecontext token rotation from the morning session — holds, but two other copies exist untouched

Re-verified the original review's fix:

- `agent/telecontext-token.json` — gone from the repo (as expected,
  moved during the morning fix). The actual quarantined file now lives
  at `/tmp/pi-secret-quarantine/telecontext-token.json.expired.20260831-090815`
  (not directly in `/tmp/`, but still outside the repo and outside `~`
  — consistent with the review's stated action, docs said "moved to
  `/tmp/`" which is true at one directory level deeper).
- `git check-ignore -v agent/telecontext-token.json` still matches
  (`.gitignore` patch holds).

**Newly found, not covered by the morning review:** two more live
(**non-expired**) copies of this same credential family exist outside
`~/.pi`, discovered by a broader filesystem search this pass:

- `/Users/A94984797/.telecontext_tokens.json` — `expires_at` is
    **2026-05-21 13:09**, i.e. already ~3 months expired relative to
    today (2026-08-31). Sitting directly in the home directory, not in
    any git repo, `-rw-r--r--` (world-readable within normal Unix
    perms). Low urgency since it's expired, but still a stale credential
    sitting unencrypted in plaintext at `~`.
- `/Users/A94984797/Workspace/pi-tools/.pi/cache/telecontext_tokens.json`
    — the same file the original review already flagged as "still
    open, out of scope." Re-checked this pass: it **is** correctly
    gitignored in that workspace (`.gitignore:225` pattern
    `.pi/cache/` matches, confirmed via `git check-ignore -v`), so no
    tracked-secret risk there — but its `expires_at` is
    **2026-07-14 22:26**, also already expired. No action needed
    beyond what the original review already said (out of `~/.pi`
    scope), but worth a decision on whether to delete both stale
    plaintext copies given they're expired and unlikely to be replayed,
    versus leaving them (a `tc-auth.py` refresh will silently overwrite
    on next legitimate use).

**Action taken this session:** none on these two extra copies —
flagging only, consistent with the original review's own scope rule
(don't touch things outside `~/.pi`, and `~/.telecontext_tokens.json` is
directly in `$HOME`, arguably borderline but treated as "not this repo"
here too). Recommend a deliberate decision (delete vs. leave) rather
than a reflexive fix.

## 2. Re-check of the original review's pre-flight checklist

1. **Run one real `llmhub/claude-sonnet-4.6` session, confirm
   `cacheRead > 0`.** — **Still open.** Re-ran
   `scripts/session-usage-report.py` this pass: `llmhub/claude-sonnet-4.6`
   shows **9,209 turns / 1.55B input tokens / cacheRead = 0** across all
   time. Checked every session file modified *after* the fix landed
   (commit `f93a8e2`, 2026-08-31 09:10:32) that touches any `llmhub`
   model at all — found none; every session since the fix used `GLM-5.2`
   or `anthropic/claude-sonnet-5` only. The fix remains config-correct
   but **unproven in production**, unchanged from this morning.
2. Telecontext token rotation — **done** (re-verified above), with the
   two newly-found extra copies now flagged as a small addendum.
3. `claude-opus-5` compat flag — **done**, re-verified: `agent/models.json`
   still shows `"compat": {"cacheControlFormat": "anthropic"}` on
   `openrouter/anthropic/claude-opus-5`, JSON still parses.
4. **Pin `smoke-test-extensions.sh`'s default model** — **still open.**
   `scripts/smoke-test-extensions.sh:41` still reads
   `MODEL="${SMOKE_TEST_MODEL:-openai-codex/gpt-5.5}"`, not
   `otc-internal/GLM-5.2` (the actual `defaultModel` in
   `agent/settings.json`). Confirmed this is a live problem, not
   theoretical: running the smoke test in the current shell (no
   `openai-codex` credential present — `agent/auth.json` is `[]`)
   produces **0/10 passed**, indistinguishable from a real guardrail
   failure without checking the error text
   (`No API key found for openai-codex`).
5. **Fate of `anthropic/claude-sonnet-4-6`** — **still open, and now
   more urgent.** Re-ran the usage report: this exact provider/model
   string is the single largest cost line item in the entire report —
   **3,477 turns, 23M input, 660M cacheRead, €359.66** — and it does
   **not exist as a provider or model id anywhere in the current
   `agent/models.json`** (`git grep` for `anthropic/claude-sonnet-4-6`
   and for a bare `"anthropic"` provider key both come back empty; the
   provider list is `ollama, otc-internal, openrouter, ai-engineer,
   llmhub`). Two explanations, unresolved: either (a) this was a
   provider id from *before* the `openrouter`/`llmhub` restructuring,
   fully retired, and the €359 is sunk historical cost with nothing to
   fix going forward — or (b) it's still somehow reachable (e.g. via a
   raw `anthropic` provider a user could add back, or leftover
   `enabledModels` wildcard) and quietly uncached today. Needs an
   explicit decision-log entry either way; currently just sitting as an
   open question in both reviews.
6. `advisor-pi` use-cap / `cache-warm` metrics — **not independently
   re-checked this pass** (both TUI-only per the original review; this
   session is also non-interactive/scripted-tool-heavy, same limitation
   applies).
7. **Spot-check 1-2 zero-cacheRead historical sessions** — spot-checked
   two of the report's flagged `llmhub/claude-sonnet-4.6` sessions by
   filename/date (2026-08-24, 135M input; 2026-08-10, 76M input) —
   both predate the fix commit (2026-08-31 09:10:32), consistent with
   "pattern stopped generating *new* instances the moment the fix
   landed, simply because llmhub hasn't been used again since," not
   "the fix is verified working." Still an open verification gap per
   item 1.
8. Standard pre-flight (JSON valid, `git status` clean, smoke test
   green with a real authenticated model) — **JSON valid** (re-ran all
   three `python3 -c "import json; json.load(...)"` checks, all pass).
   **`git status` clean** of secrets, aside from the newly-noted
   untracked `.pi/` directory (not a secret, flagged separately above).
   **Smoke test not green** — same pre-existing `openai-codex`
   credential gap as item 4, not a new finding.

## 3. Net assessment

Nothing critical or newly broken. The `docs/` reorg itself introduced no
regressions (all cross-references updated and verified, JSON still
valid, no secrets moved or exposed in the process). The list of
**genuinely still-open items is unchanged from this morning's review**,
plus two small additions:

- (new) an untracked, 78 MB `~/.pi/.pi/` directory that isn't secret but
  isn't gitignored either — needs a deliberate `.gitignore` decision, not
  a blind pattern.
- (new) two more stale-but-expired copies of the telecontext credential
  outside the repo (`~/.telecontext_tokens.json` and the already-known
  `pi-tools` cache copy) — low urgency since both are expired, but worth
  an explicit keep-or-delete decision.
- (carried over, unchanged) llmhub cache-fix still unverified in
  production — zero llmhub usage since the fix landed;
  smoke-test default model still unpinned; fate of the €359
  `anthropic/claude-sonnet-4-6` line item still undecided.

**Recommended next single action:** run one real `llmhub/claude-sonnet-4.6`
turn-2+ session and re-check `cacheRead` — same as this morning's
top-priority item, still the highest-value thing left undone.
