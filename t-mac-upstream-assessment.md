# `t-mac` → `main` assessment and refactor plan

**Date:** 2026-08-31 (assessment session)
**Scope:** `git diff main origin/t-mac` (3 commits: `ebbb6ae`, `f93a8e2`,
`9818406`). Goal: identify what in `t-mac` is genuinely portable and worth
cherry-picking into `main`, versus what must stay branch-local because it
encodes a different machine's identity (user `A94984797` vs `brooklyn`,
the `otc-internal` LLM provider, a different Obsidian vault path, a
different `trust.json`).

**Ground rule carried forward from this repo's own conventions:** `main`
and `t-mac` stay separate — this doc is a menu to cherry-pick *from*, not
a merge/rebase proposal. Nothing here should be applied by blindly merging
the branch.

## 1. How the diff breaks down

| Category | Files | Verdict |
| --- | --- | --- |
| Machine identity (user paths, provider config, vault path, trust list) | `agent/models.json`, `agent/settings.json`, `agent/trust.json` | **Branch-local only — do not port.** |
| Doc-only path updates (`setup-refactor-plan.md` → `docs/setup-refactor-plan.md`) inside portable files | `AGENTS.md`, `README.md`, comment headers in 6 extension files | **Port the *decision* (adopt a `docs/` dir), not these literal path-only diff hunks** (t-mac's are relative to a reorg `main` hasn't done yet). |
| Pure formatting (prettier line-wrap, table pipe spacing) | `permission-gate.ts`, `git-checkpoint.ts`, `session-stats.ts`, `theme-cycler.ts`, README tables | **Cosmetic no-op — skip**, not worth a diff for its own sake. |
| Real bug fixes, no machine dependency | `agent/models.json` (`claude-opus-5` cache-compat flag), `.gitignore` (2 new patterns), `obsidian-sync.ts` (3 logic fixes), `scripts/smoke-test-extensions.sh` (default-model + regex robustness) | **Port — see §2, concrete diffs below.** |
| New audit/process docs, machine-specific content but reusable *pattern* | `docs/harness-review-2026-08-31*.md`, `docs/sandboxing-concept.md` | **Don't port the docs verbatim (full of `A94984797` paths); port the pattern/checklist as a reusable process — see §3.** |

## 2. Concrete, portable fixes to cherry-pick into `main`

These are safe to apply to `main` essentially as-is; none depend on the
`otc-internal` provider, the `A94984797` user, or the different vault path.

### 2.1 `agent/models.json` — missing cache-compat flag on `claude-opus-5`

`main`'s `openrouter` provider currently has **no models array at all**
(provider block only has `baseUrl`/`apiKey`/`api`) — the actual Claude
models on `main` live under the `llmhub` provider instead. Checked
`main`'s `llmhub/claude-opus-4.6` entry directly: it **already carries**
`compat.cacheControlFormat: "anthropic"` (inherited from the earlier
incident fix documented in `prompt-cache-analysis.md`), so there is no
equivalent gap to close on `main` today. **The applicable gap on `main`
would be different from `t-mac`'s** (different provider layout: `llmhub`
vs. `openrouter`), but the underlying rule is the same: **any Claude model entry with
`cacheRead`/`cacheWrite` pricing must carry
`compat.cacheControlFormat: "anthropic"` or caching silently no-ops.**
Action: audit `main`'s `llmhub` block once more for any Claude entry
missing the flag — none found as of this assessment, but re-run this
check any time a Claude model is added, not just once.

### 2.2 `.gitignore` — two coverage gaps found and fixed on `t-mac`

```diff
 **/*credentials*
+**/*-token.json
+agent/telecontext-token.json
 ...
 agent/.update-check
+.update-check
```

`main` has neither pattern. Even though `main` doesn't currently have a
`telecontext-token.json` or a root-level `.update-check` on disk, the
*pattern class* is real and cheap insurance:

- `**/*-token.json` catches any future OAuth/token cache file that
  `**/*.token`/`**/*.secret`/`**/*credentials*` don't match (different
  naming convention).
- Root-level `.update-check` — `main`'s `.gitignore` only excludes
  `agent/.update-check`; if pi ever writes one at the repo root on this
  machine too, it would currently show up in `git status`.

**Recommended: port both lines verbatim.** Zero risk, closes a real gap
class regardless of which machine.

### 2.3 `agent/extensions/obsidian-sync.ts` — three logic fixes, no machine dependency

a) **Dry-run image count was already correct**, no functional change,
   just reordered (`if (options.dryRun) {...} else {...}` vs. the
   original `if (!options.dryRun) {...} else {...}`) — skip, not a fix.

b) **`resolveMarkdownSelection` didn't expand `~` or resolve
   relative-to-cwd paths** for explicit file args — before:

   ```ts
   options.explicitFiles.map((f) => normalizeRelativePath(f))
   ```

   after:

   ```ts
   options.explicitFiles.map((f) => {
     const expanded = expandTilde(f);
     const absolute = path.resolve(cwd, expanded);
     return normalizeRelativePath(path.relative(cwd, absolute));
   })
   ```

   plus a new `expandTilde()` helper. **Real fix** — `/obsidian sync
   ~/notes/foo.md` or an absolute path passed as an explicit file arg
   would previously fail the `fsSync.existsSync` filter silently (wrong
   path joined against `cwd`) instead of syncing the file. No machine
   dependency; the `~` expansion uses `process.env.HOME`, portable.

c) **`relativePathToSafeMarkdownName` didn't strip leading `../` segments**
   before turning a path into a flat filename — before:

   ```ts
   noExt.replace(/^[.][/\\]?/, "")...
   ```

   after, with a new line added first:

   ```ts
   noExt.replace(/^(?:\.\.[/\\]?)+/, "").replace(/^[.][/\\]?/, "")...
   ```

   **Real fix** — without this, a markdown file reached via `../` (e.g.
   syncing a file outside the sync root) could produce a leaked
   `..`-prefixed or malformed Obsidian filename instead of a flattened
   safe name. Small, self-contained, no machine dependency.

**Recommended: port (b) and (c) verbatim**, including the new
`expandTilde` helper. Re-run `lsp_diagnostics` on the file after.

### 2.4 `scripts/smoke-test-extensions.sh` — default-model fragility + brittle regex

Two independent fixes, both proven necessary by `t-mac`'s own harness
review (`docs/harness-review-2026-08-31.md` §1, "0/10 passed" reproduced
live):

a) **Pin the fallback model to the branch's own real default**, not a
   model that may be uncredentialed in a given shell:

   ```diff
   -MODEL="${SMOKE_TEST_MODEL:-openai-codex/gpt-5.5}"
   +MODEL="${SMOKE_TEST_MODEL:-<this-machine's real defaultModel>}"
   ```

   **`main`'s applicable value is `openrouter/anthropic/claude-sonnet-5`**
   (its actual `agent/settings.json` `defaultModel`), not `t-mac`'s
   `otc-internal/GLM-5.2` — the *fix pattern* ports, the *literal value*
   does not. Verified live on `main`: `agent/auth.json` currently has
   `openai-codex` + `anthropic` credentials but the script's hardcoded
   default is `openai-codex/gpt-5.5` specifically (not just any
   `openai-codex/*`) — worth confirming that exact model id is reachable
   before assuming today's script is fine; if not, this is a live bug on
   `main` too, independent of the port.

b) **Loosen the over-strict `reply ok` / regex checks** that made the
   smoke test brittle against normal model phrasing variance
   (punctuation, capitalization, slightly different refusal wording):

   ```diff
   -check "no-tools load, no errors" '^ok$' ... "reply ok"
   +check "no-tools load, no errors" '^[Oo]k\.?[[:space:]]*$' ... \
   +  "reply with exactly the single word ok, lowercase, no punctuation"
   ...
   -"(blocks dangerous|[Cc]an.t run|[Bb]locked).*(dangerous|force)"
   +"([Bb]locked|[Cc]an.t run|safety guard|[Dd]estructive).*(force|dangerous|history)"
   ```

   This is a pure test-robustness improvement, no machine dependency.

**Recommended: port (b) verbatim; port (a)'s *pattern* using `main`'s own
default model value, and verify `main`'s smoke test is actually green
before and after — don't assume, run it.**

## 3. Process/pattern takeaways (don't port the docs, port the habit)

`t-mac`'s two harness-review docs and the sandboxing concept doc are full
of `A94984797`-specific findings and can't be copied over, but the
*process* they demonstrate is worth adopting on `main` too:

1. **A repeatable "harness review" checklist** — secrets/gitignore sweep,
   prompt-cache compat-flag audit, smoke-test-with-real-default-model
   check, `git status` clean check — run periodically, not just once.
   `t-mac` ran this twice in one day (morning + followup) and caught a
   *new* untracked-directory issue on the second pass that the first
   pass missed. Consider adding a lightweight version of this as a
   documented recurring task in `main`'s `setup-refactor-plan.md`
   ("Recommended next steps"), e.g. re-run before any release-style
   milestone.
2. **Follow up on your own "still open" items** — the followup review's
   most valuable finding was re-checking unresolved items from the first
   review rather than treating "flagged" as "done." `main`'s own
   `setup-refactor-plan.md` has open items too; worth an explicit
   re-check pass the same way, independent of anything from `t-mac`.
3. **Sandboxing concept doc's actual reusable output isn't the doc, it's
   the trigger question**: *"does this trusted project actually ingest
   untrusted external content (fetched web pages, third-party documents,
   issue/PR text), and if so, does `pi-web-access` + the regex guardrails
   constitute real isolation for it?"* `main`'s own `trust.json` lists
   `bulliexplorer`, `doc-manager`, `idp-docs` — worth running that same
   triage question against `main`'s real trust list (not the stale
   `t-mac` list), as its own independent piece of work. Not urgent, but
   cheap to note now while the question is fresh.
4. **Backup-before-editing discipline held up in practice** — every config
   edit in `t-mac`'s log took a `.bak.<timestamp>` first. `main`'s own
   `AGENTS.md` already mandates this; nothing to change, just a confirmed
   validation that the rule is worth keeping as-is.

## 4. Explicitly do NOT port

- `agent/trust.json` — different users, different projects entirely.
  Porting this would trust the wrong paths on `main`'s machine.
- `agent/settings.json`'s `defaultProvider`/`defaultModel`/`enabledModels`/
  `contextPrune.summarizerModel` — all point at `otc-internal`/`ai-engineer`
  providers that don't exist in `main`'s `models.json`. Porting the raw
  values would break `main` outright.
- `agent/models.json`'s `otc-internal` provider block, the `ollama` model
  list changes (`llama3.1:8b`/`qwen2.5:7b`/`mistral:latest`/`phi4:latest`
  replacing `main`'s `qwen3:4b-instruct`/`qwen2.5:7b`/`qwen3:8b`), and the
  `openrouter` models array (`t-mac` moved Claude models from `llmhub` to
  `openrouter` with different ids/pricing than `main` uses) — a full
  provider-topology divergence, not a portable fix.
- `agent/settings.json`'s `obsidian.vaultPath` (`/Users/A94984797/Documents/ObsidianVault`
  vs. `main`'s `/Users/brooklyn/Documents/obsidian`) — machine-specific by
  definition.
- The `docs/` directory reorg itself, taken as a literal diff — `t-mac`'s
  hunks rewrite paths that assume the move already happened; `main` hasn't
  moved anything yet. If `main` wants the same `docs/` layout, treat it as
  a **fresh, independent reorg on `main`**, not a cherry-pick, so the
  cross-reference updates are computed against `main`'s actual current
  paths instead of `t-mac`'s.
- `docs/sandboxing-concept.md` and both `harness-review-2026-08-31*.md`
  files verbatim — riddled with `A94984797` paths and `t-mac`-specific
  findings (otc-internal, telecontext token locations under
  `/Users/A94984797/...`). Only the process pattern in §3 is portable.

## 5. Refactor plan for `main` (ordered, smallest/safest first)

1. **`.gitignore`**: add `**/*-token.json` and top-level `.update-check`
   (§2.2). Validate: `git check-ignore -v .update-check` and
   `git check-ignore -v agent/telecontext-token.json` (or an equivalent
   `*-token.json` test file) both match.
2. **`obsidian-sync.ts`**: port the `expandTilde` helper +
   `resolveMarkdownSelection` fix + the `../`-stripping fix in
   `relativePathToSafeMarkdownName` (§2.3 b, c). Validate: `lsp_diagnostics`
   clean, then a manual `/obsidian sync <absolute-or-~-path>` smoke check
   in a scratch project and a manual check that a file reached via `../`
   produces a flattened name with no leading `..`.
3. **`scripts/smoke-test-extensions.sh`**: loosen the two brittle
   regexes (§2.4 b) and re-pin the fallback model to `main`'s actual
   `defaultModel` (`openrouter/anthropic/claude-sonnet-5`, not
   `t-mac`'s `otc-internal/GLM-5.2` — confirm this against
   `agent/settings.json` again at implementation time in case it's
   changed). Validate: run the script twice — once with `SMOKE_TEST_MODEL`
   unset (exercises the new default) and once pointed at another
   credentialed model — both should reach the same pass count.
4. **`agent/models.json`**: run the cache-compat-flag audit described in
   §2.1 against `main`'s current `llmhub` (and any other Claude-bearing)
   provider block. If a gap is found, fix it the same way the original
   incident writeup (`prompt-cache-analysis.md`) recommends, with a
   backup taken first per `AGENTS.md`'s rule.
5. **`setup-refactor-plan.md`**: add one decision-log entry recording
   which of the above were applied, when, and how each was verified —
   per this repo's own convention ("ran X, got Y", not "should work now").
   Reference this assessment doc by name in that entry.
6. **(Optional, separate follow-up, not bundled with the above)**: decide
   whether `main` wants the same `docs/` subdirectory reorg `t-mac` did.
   If yes, do it as its own change on `main` with its own cross-reference
   audit (README.md/AGENTS.md/all six extension file comment headers/both
   scripts) — do not attempt to reuse `t-mac`'s diff hunks for this, since
   they're computed against a different starting state.
7. **(Optional, low urgency)**: run the sandboxing triage question from
   §3.3 against `main`'s real `trust.json` (`bulliexplorer`,
   `doc-manager`, `idp-docs`) and note the outcome in
   `setup-refactor-plan.md`, independent of anything from `t-mac`.

## 6. Verification checklist for whoever executes the plan

Per `AGENTS.md`'s existing PR/change checklist — nothing new required
beyond what's already mandated:

- [ ] JSON configs validated (`python3 -c "import json; json.load(...)"`)
      for `agent/settings.json`, `agent/models.json`, `web-search.json`.
- [ ] `scripts/smoke-test-extensions.sh` green after each extension/script
      change in this plan.
- [ ] `git status --short` checked clean of secrets/sessions/backups
      before any commit.
- [ ] Public surface diff (commands/tools/settings keys) checked — none
      of the items above should change it, but confirm rather than assume.
- [ ] `setup-refactor-plan.md` updated with a dated entry per item 5 above.
