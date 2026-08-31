# Pi Setup Guide

_As-is documentation of the local `pi` coding agent installation at `~/.pi`._
_Last verified: pi CLI `@earendil-works/pi-coding-agent` v0.84.4, 2026-08-29._
_Regenerated from live config after Phases 2–4 of `setup-refactor-plan.md` (see that file for history/rationale)._

---

## 1. Overview

This machine runs [pi](https://github.com/earendil-works/pi), a terminal coding
agent, configured under `~/.pi`. `~/.pi` **is** a git repo (branch `t-mac`, as of
2026-08-31) with secrets/sessions/backups gitignored — see `AGENTS.md` for the
commit checklist. Timestamped manual backups also exist under `~/.pi/backups/`
and as `*.bak.<timestamp>` files alongside edited configs for changes made
outside a commit.

Directory roles:

| Path | Role |
| --- | --- |
| `~/.pi/agent/` | **Global agent home** — settings, models, auth, extensions, themes, sessions. Shared across all projects. |
| `~/.pi/agent/.pi/` | Project-local config for `~/.pi` itself (project-scoped MCP packages, web-fetch cache). |
| `~/.pi/agent/npm/` | User-scope installed packages (`pi-web-access`, `pi-condense`). |
| `~/.pi/agent/extensions/` | Global TypeScript extensions, loaded on every `pi` invocation. |
| `~/.pi/searxng/` | Local SearXNG Docker Compose setup for private web search. |
| `~/.pi/README.md` | Top-level project README (kept at root, not moved). |
| `~/.pi/docs/` | Setup/audit documentation (this file, `setup-refactor-plan.md`, `prompt-cache-analysis.md`, `llmhub-model-pricing.md`, harness review docs). Moved here from the repo root 2026-08-31 to reduce root clutter. |

---

## 2. Global Settings — `~/.pi/agent/settings.json`

```json
{
  "defaultProvider": "openrouter",
  "defaultModel": "anthropic/claude-sonnet-5",
  "defaultThinkingLevel": "medium",
  "quietStartup": true,
  "theme": "dark",
  "hideThinkingBlock": false,
  "enabledModels": [
    "openrouter/anthropic/claude-sonnet-5",
    "openrouter/z-ai/glm-5.3",
    "openrouter/moonshotai/kimi-k3",
    "openrouter/deepseek/deepseek-v4-pro",
    "openai-codex/gpt-5.6-luna",
    "openai-codex/gpt-5.6-terra",
    "openai-codex/gpt-5.6-sol",
    "ollama/qwen3:4b-instruct",
    "llmhub/claude-sonnet-4.6"
  ],
  "showCacheMissNotices": true,
  "compaction": { "enabled": true, "reserveTokens": 16384, "keepRecentTokens": 20000 },
  "retry": {
    "enabled": true, "maxRetries": 3, "baseDelayMs": 2000,
    "provider": { "maxRetries": 0, "maxRetryDelayMs": 60000 }
  },
  "contextPrune": {
    "enabled": true,
    "pruneOn": "agent-message",
    "summarizerModel": "openrouter/openai/gpt-4.1-mini",
    "autoBudgetThreshold": 0.3,
    "summarizerConcurrency": 2,
    "protectedPaths": ["**/.env*", "**/auth.json", "**/.ssh/**", "**/.gnupg/**", "**/node_modules/**", "**/.git/**"]
  },
  "packages": ["npm:pi-web-access", "npm:pi-condense@2.9.1"]
}
```

Also present, not shown above: an `obsidian` block syncing `README.md`/`AGENTS.md`/`CLAUDE.md`/
`SUMMARY.md`/`docs/**`/`setup-doc/**`/`.pi/**` markdown into
`/Users/brooklyn/Documents/obsidian` via the `obsidian-sync.ts` extension.

**Default model** is intentionally the cheaper `openrouter/anthropic/claude-sonnet-5` at
`medium` thinking, not an Opus-tier model at `high` — see `setup-refactor-plan.md` P1 for why.

---

## 3. Model Providers — `~/.pi/agent/models.json`

Three custom providers configured, all via `openai-completions` compat:

| Provider | Auth | Models defined | Notes |
| --- | --- | --- | --- |
| `openrouter` | `!security find-generic-password -ws 'openrouter-api-key'` | none manual — catalogue-backed via `models-store.json` | No duplicate manual entries; inherits fetched cost/compat metadata automatically. |
| `llmhub` | `!security find-generic-password -ws 'llmhub'` | `gpt-5`, `claude-sonnet-4.5`, `claude-sonnet-4.6`, `claude-opus-4.6` | Only `claude-sonnet-4.6` is in `enabledModels`. Cost figures cross-checked against `~/.pi/docs/llmhub-model-pricing.md` (2026-08-29); `claude-opus-4.6` cost is unconfirmed and **may not be a real offering** on this LLMHub tenant — its name doesn't appear in the pricing catalog. Claude models carry `compat.cacheControlFormat: "anthropic"` so pi emits Anthropic-style `cache_control` breakpoints (see `prompt-cache-analysis.md` for why this matters — a real ~€275 session ran with zero cache reuse before this flag existed). |
| `ollama` | none (local) | `qwen3:4b-instruct`, `qwen2.5:7b`, `qwen3:8b`, `llama3.1:8b`, `mistral:latest`, `phi4:latest` | No longer used as the `contextPrune` summarizer (see below) — available for manual/local use. Compat flags `supportsDeveloperRole: false`, `supportsReasoningEffort: false` set for OpenAI-completions compatibility. |

**Authoritative LLMHub cost reference:** `~/.pi/docs/llmhub-model-pricing.md` (35-model catalog,
PO-supplied 2026-08-29). Check that file before changing any `llmhub/*` cost figure — do not
carry a cost estimate across model tiers without checking it first (this happened once already
and was wrong: `claude-sonnet-4.5` had incorrectly inherited `claude-sonnet-4.6`'s rate).

---

## 4. Cost & Context Controls

| Setting | Value | Purpose |
| --- | --- | --- |
| `showCacheMissNotices` | `true` | Surfaces when a request misses the prompt cache. |
| `compaction.enabled` | `true` | Rewrites/trims history once the context approaches the model's window. |
| `compaction.reserveTokens` | `16384` | Headroom reserved before compaction triggers. |
| `compaction.keepRecentTokens` | `20000` | Recent turns kept verbatim through compaction. |
| `retry.provider.maxRetries` | `0` | Deliberately 0 — avoids interfering with provider-side usage-limit handling (per pi docs). |
| `contextPrune` (pi-condense) | enabled, `agent-message` trigger, `openrouter/openai/gpt-4.1-mini` summarizer | Summarizes finished tool-call batches to keep long sessions affordable; originals recoverable via `context_tree_query`. Protected paths prevent secrets/credentials from ever being pruned/summarized. Switched from `ollama/qwen3:4b-instruct` 2026-08-29 after repeated "summarizer failing, using session model" fallback warnings — a hosted model removes the local-inference latency/load variability that was tripping the fallback controller. |

---

## 5. Global Extensions — `~/.pi/agent/extensions/`

| File | Purpose | Status (2026-08-29) |
| --- | --- | --- |
| `permission-gate.ts` | Confirms/blocks dangerous bash commands (destructive fs/data ops, network egress, git push/publish, global installs, credential reads). | Expanded 2026-08-29 — see `setup-refactor-plan.md` Phase 4 item 4. |
| `protected-paths.ts` | Blocks write/edit to secrets, pi's own config files, SSH/GPG material, generic token/secret-shaped filenames. | Expanded 2026-08-29, same source. |
| `git-checkpoint.ts` | Stashes a recoverable checkpoint per turn so `/fork` can restore code state. | Optimized 2026-08-29 to skip on non-git dirs and clean working trees instead of shelling out every turn. |
| `status-footer.ts` | Renders git branch/dirty state, model, cost, context metrics in the footer. | Import path fixed; dead `session_switch`/`session_fork` handlers removed (not real pi events). |
| `tool-counter-widget.ts` | Tracks/display per-session tool-call counts. | Same fixes as above. |
| `welcome-dashboard.ts` | Startup dashboard (pi version, model, recent sessions). | Hardcoded, now-deleted package.json path replaced with `execFileSync("pi", ["--version"])`; dead session events removed. |
| `session-name.ts` | Auto-names sessions. | Import path fixed only. |
| `theme-cycler.ts` / `themeMap.ts` | Theme switching support. | Import path fixed only. |
| `obsidian-sync.ts` | Syncs project docs into an Obsidian vault. | Import path fixed only. |

All 10 files import from `@earendil-works/pi-coding-agent` / `@earendil-works/pi-tui` (renamed
2026-08-29 from the stale `@mariozechner/*` namespace, which no longer exists on disk).

---

## 6. Web Search — `~/.pi/web-search.json`

```json
{
  "searchRouting": {
    "providers": ["searxng", "exa", "openai", "brave", "tavily"],
    "fallbackOn": ["unsupported", "transient", "quota", "network", "invalid-response"]
  },
  "workflow": "summary-review",
  "searxngBaseUrl": "http://127.0.0.1:8888",
  "ssrf": { "allowRanges": ["127.0.0.1/32"] }
}
```

Daily default (2026-08-29 onward) is SearXNG-first sequential routing — tries the local,
free SearXNG instance first and only falls through to paid providers on a real typed
failure, instead of fanning every call out across all 5 providers concurrently.

For research that needs full multi-provider coverage, use
`/high-stakes-web-research <topic>` (`~/.pi/agent/prompts/high-stakes-web-research.md`),
which explicitly sets the old 5-provider array plus `includeContent: true` and a
`source_check` step for load-bearing claims.

Local SearXNG (`~/.pi/searxng/docker-compose.yml`, container `pi-searxng`) is bound to
`127.0.0.1:8888` only, confirmed healthy.

---

## 7. Trust — `~/.pi/agent/trust.json`

```json
{
  "/Users/brooklyn/Workspace/bulliexplorer": true,
  "/Users/brooklyn/Workspace/doc-manager": true,
  "/Users/brooklyn/Workspace/idp-docs": true
}
```

Project trust is **not a sandbox** (per pi's own docs) — no container/VM isolation exists for
any of these. Worth revisiting if any of them ever process untrusted external input (see
`setup-refactor-plan.md` "Recommended next steps").

---

## 8. Known Open Items

See `~/.pi/docs/setup-refactor-plan.md` for the full, maintained list with status tracking. As of
2026-08-29, still open:

- ~~Phase 5: web-search daily-vs-high-stakes split~~ ✅ done 2026-08-29
- ~~Phase 7: MCP cleanup~~ ✅ done 2026-08-29 — `pi-mcp-adapter` removed
- ~~Phase 8: session retention/archival~~ ✅ done 2026-08-29 — `~/.pi/scripts/archive-old-sessions.sh` + `~/.pi/scripts/session-usage-report.py`
- LLMHub end-to-end cache verification (blocked on the LLMHub project's monthly budget limit)
- `llmhub/claude-opus-4.6` availability unconfirmed (not in the pricing catalog at all)
- ~~Formal extension smoke-test script~~ ✅ done 2026-08-29 — `~/.pi/scripts/smoke-test-extensions.sh`
- Sandboxing for trusted projects that may process untrusted input

## 9. Maintenance Scripts — `~/.pi/scripts/`

| Script | Purpose | Run when |
| --- | --- | --- |
| `smoke-test-extensions.sh` | 9 checks covering extension load, `permission-gate.ts` (dangerous/credential/benign commands), `protected-paths.ts` (write/edit tool AND bash-redirection bypass), `git-checkpoint.ts` (git/non-git dirs). | After **any** edit to `~/.pi/agent/extensions/*.ts`. |
| `archive-old-sessions.sh` | Tars+gzips session `.jsonl` files older than N days (default 90) to `~/.pi/session-archives/`, verifies before deleting originals. `--dry-run` supported. | Monthly (manual). |
| `session-usage-report.py` | Aggregates token usage/cost by provider/model from live + (`--include-archives`) archived sessions; flags high-input-zero-cacheRead sessions. `--since`, `--json` supported. | Whenever checking spend, or after a caching-related config change. |

## 10. Maintenance

Regenerate this file whenever a phase in `setup-refactor-plan.md` is completed and materially
changes what's live — treat `setup-refactor-plan.md` as the working document with full history/
rationale, and this file as the periodically-refreshed as-is summary for quick reference.
