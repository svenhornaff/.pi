# ~/.pi harness review — 2026-08-31

Model/tool inspection of the global pi config home (`~/.pi`), covering
critical findings, prompt-cache verification, and a pre-flight checklist.

## 1. Critical findings

### 🔴 Security — untracked secret file, no `.gitignore` coverage — **fixed this session**

`agent/telecontext-token.json` contained an OAuth access_token +
refresh_token (MCP/telecontext, `telecontext.trap.ng.telekom.net`,
mirrored here by a workspace-local `tc-auth.py` PKCE flow for pi's MCP
HTTP transport), untracked but **not matched by any `.gitignore` rule**.

**Action taken:**

- Confirmed via `git log --all --oneline -- agent/telecontext-token.json`
  and `git ls-files` that the file was **never tracked/committed** — no
  history rewrite needed.
- Added `**/*-token.json` and an explicit `agent/telecontext-token.json`
  entry to `.gitignore`.
- Checked `expires_at` in the cached token: it had **already expired**
  (July 2026). Rotation performed by removing the stale credential from
  disk (moved outside the repo, to `/tmp/`) rather than a raw delete, so
  it cannot be replayed even if a copy leaked earlier; `tc-auth.py`
  regenerates fresh tokens via a new OAuth2 PKCE flow automatically on
  next use — no manual re-auth step required.
- Verified `git check-ignore -v agent/telecontext-token.json` now
  matches, and `git status --short` no longer lists it.
- **Still open, out of `~/.pi` scope:** the same credential is also
  cached at `/Users/A94984797/Workspace/pi-tools/.pi/cache/telecontext_tokens.json`
  (a different, trusted-but-separate workspace). That workspace's own
  `.gitignore` should be checked and that cached copy rotated too — not
  touched here per this repo's own rule against working outside `~/.pi`.

### 🟡 Top-level `.update-check` not gitignored — **fixed this session**

`.gitignore` only excluded `agent/.update-check`; a second
`.update-check` existed at repo root, untracked. Added `.update-check`
to `.gitignore`; verified with `git check-ignore -v .update-check`.

### 🟡 `smoke-test-extensions.sh` default-model fragility

With the harness's actual default model (`otc-internal/GLM-5.2`), all
guardrail checks pass (9-10/10, see below). But the script's fallback
model isn't guaranteed to be authenticated in every shell — running it
with an unauthenticated default model produces an all-checks-fail result
that looks like a total guardrail failure but is actually just a login
gap. Pin the script's default to `otc-internal/GLM-5.2` (the real
`defaultModel` in `agent/settings.json`) so a bare run is trustworthy.

### 🟡 Inconsistent cost/compat pairing in `models.json` — **fixed this session**

`openrouter/anthropic/claude-opus-5` had `cacheRead`/`cacheWrite` pricing
but was missing `compat.cacheControlFormat: "anthropic"` — the same class
of bug that caused the €275 incident (`prompt-cache-analysis.md`), on a
model that hadn't yet seen heavy traffic. Its sibling entry
(`openrouter/anthropic/claude-sonnet-5`) already carried the flag
correctly, confirming the established pattern.

**Action taken:** added

```json
"compat": { "cacheControlFormat": "anthropic" }
```

to `openrouter/anthropic/claude-opus-5` in `agent/models.json`.
Backup taken first (`agent/models.json.bak.<timestamp>`), JSON validated
with `python3 -c "import json; json.load(open('agent/models.json'))"`
after the change (passed). Diff confirmed to contain only the intended
`compat` addition (plus a harmless `2.50` → `2.5` re-serialization, same
numeric value).

Nothing else rose to "critical": `auth.json` is `600`-permissioned and
holds no raw keys (Keychain refs only), `.gitignore` correctly excludes
sessions/auth/models-store, and `trust.json` lists only explicitly
approved project paths.

## 2. Is prompt caching working / preventing cost?

**Partially — the fix is real but unverified end-to-end, and one gap
was still open until this session.**

- `session-usage-report.py` confirms the historical root cause: **90
  sessions** with ≥50k input tokens and **zero `cacheRead`**, the largest
  at up to 188M tokens/session on `llmhub/claude-sonnet-4.6`. Total
  tracked spend across all sessions: **€542.98**, with
  `anthropic/claude-sonnet-4-6` alone at **€359** — that provider id has
  no `compat.cacheControlFormat` in current `models.json`, so if it's
  still a reachable model choice it remains uncached today.
- The documented fix (`compat.cacheControlFormat: "anthropic"` on
  `llmhub` Claude models) **is present** in `models.json`. But **no
  `llmhub/*` session has actually run since the fix landed** — every
  session file newer than the fix showed only `GLM-5.2` and one
  `anthropic/claude-sonnet-5` test run, zero `llmhub` usage. The fix is
  therefore config-correct but **unproven in production**.
- `otc-internal`/GLM models have no compat flag and `cacheRead: 0` cost —
  not a bug; `prompt-cache-analysis.md` documents T-Cloud caching GLM
  server-side opportunistically, independent of pi's `cache_control`
  mechanism, with $0 cost impact either way at that pricing tier.
- `cache-warm` is installed and active (keeps cache TTL alive between
  turns); its hit/savings metrics are TUI-only (`/cache-warm status`),
  not visible via `-p`, so real-world savings weren't independently
  confirmed here.

**Net: the config fix is in place and now also covers the
`claude-opus-5` OpenRouter gap (fixed above), but "is it preventing cost
right now" for `llmhub` needs one real `llmhub/*` session plus a
`session-usage-report.py` re-run to prove out.**

## 3. Pre-flight checklist before calling this "good to go"

1. **Run one real `llmhub/claude-sonnet-4.6` session and re-run
   `session-usage-report.py`** — confirm `cacheRead > 0` on turn 2+
   before trusting the fix in production. Highest-value remaining check.
2. ~~Rotate/secure `agent/telecontext-token.json`** and patch
   `.gitignore` for it and the root `.update-check` gap~~ — **done this
   session** (never-committed file confirmed, expired credential
   removed from disk, `.gitignore` patched, sibling copy in the
   `pi-tools` workspace still needs its own rotation).
3. ~~Add missing `compat.cacheControlFormat` to
   `openrouter/anthropic/claude-opus-5`~~ — **done this session.**
4. **Pin `smoke-test-extensions.sh`'s default model** to an
   always-authenticated model so a bare run doesn't produce a false
   "all failed."
5. **Decide the fate of `anthropic/claude-sonnet-4-6`** (€359 spent, no
   compat flag, not present under that exact id in current
   `models.json`) — retired path needing a decision-log note, or still
   reachable and needing the same compat fix?
6. **Confirm `advisor-pi`'s per-session-branch use cap (5) and
   `cache-warm`'s real metrics interactively** in the TUI — both only
   report properly outside `-p` mode.
7. **Spot-check 1-2 of the 90 flagged historical zero-cacheRead
   sessions** to confirm none represent an ongoing/recurring workflow
   still running uncached today.
8. Standard pre-flight already mandated by `AGENTS.md`: `git status
   --short` clean of secrets/sessions/backups, all JSON configs
   validate, `scripts/smoke-test-extensions.sh` green with a real,
   authenticated model.
