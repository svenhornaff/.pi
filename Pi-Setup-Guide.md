# Pi Setup Guide

_As-is documentation of the global `pi` configuration at `~/.pi` on the private MacBook (branch `p-mac`)._
_Last verified: pi CLI `@earendil-works/pi-coding-agent` v0.87.1, 2026-09-27, against branch `p-mac` at `9ac6f5a` (file tree identical to `3f49563`)._
_Regenerated from the tracked config. `setup-refactor-plan.md` holds the history and rationale; this file is the quick as-is reference._

---

## 1. Overview

This machine runs [pi](https://github.com/earendil-works/pi), a terminal coding
agent, configured under `~/.pi`. `~/.pi` **is a git repo** (`svenhornaff/.pi`).
Branches are machine-specific and are never merged into each other:

| Branch | Machine | Notes |
|---|---|---|
| `p-mac` | private MacBook (user `brooklyn`) | This file. |
| `t-mac` | TSI MacBook (user `A94984797`) | Adds the `otc-internal` provider, a different vault path and trust list. Portable fixes are cherry-picked, see `t-mac-upstream-assessment.md`. |

Rollback is `git revert` on the branch. For scripted edits to live config, a
timestamped `*.bak.<timestamp>` copy is still taken first (gitignored), because a
malformed `settings.json`/`models.json` breaks every pi session on the machine.

Directory roles:

| Path | Role |
|---|---|
| `~/.pi/agent/` | Global agent home: settings, models, auth, extensions, prompts, themes, sessions. Shared by all projects. |
| `~/.pi/agent/extensions/` | Global TypeScript extensions, loaded on every `pi` invocation (no build step). |
| `~/.pi/agent/prompts/` | Global prompt templates (`/name`). |
| `~/.pi/agent/npm/` | Installed npm packages from `settings.json → packages` (gitignored). |
| `~/.pi/agent/sessions/` | Session transcripts (gitignored; may contain file contents and fetched web content). |
| `~/.pi/agent/.pi/` | Project-local config for `~/.pi` itself (`settings.json` with an empty package list). |
| `~/.pi/searxng/` | Local SearXNG (Docker Compose) for private web search. |
| `~/.pi/scripts/` | Maintenance scripts, see §9. |
| `~/.pi/*.md` | Documentation, see §11. |

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
  "contextPrune": { "enabled": true, "summarizerModel": "openrouter/openai/gpt-4.1-mini", "...": "see §4" },
  "packages": [
    "npm:pi-web-access",
    "npm:pi-condense@2.9.1",
    "npm:cache-warm",
    "npm:pi-lens",
    "npm:@juicesharp/rpiv-ask-user-question",
    "npm:statusline-pi",
    "npm:@plannotator/pi-extension",
    "npm:advisor-pi"
  ]
}
```

Also present: an `obsidian` block used by `obsidian-sync.ts` (vault
`/Users/brooklyn/Documents/obsidian`, project folder `PROJECTS`; syncs `README.md`,
`AGENTS.md`, `CLAUDE.md`, `SUMMARY.md`, `docs/**`, `setup-doc/**` and `.pi/**` markdown).

`lastChangelogVersion` is written by pi itself. It still reads `0.85.1` after the
2026-09-27 revert while `0.87.1` is installed; pi updates it the next time it shows
the changelog. Commit whatever pi writes.

**Default model** is intentionally `openrouter/anthropic/claude-sonnet-5` at `medium`
thinking, a cost/capability balance rather than the strongest model available.

---

## 3. Model Providers — `~/.pi/agent/models.json`

No config file contains a raw key. Keys resolve from the macOS Keychain at call time.

| Provider | Auth | Billing | Models | Notes |
|---|---|---|---|---|
| `openrouter` | Keychain `openrouter-api-key` | per token | catalogue-backed (no manual entries) | Hosts the default `claude-sonnet-5`, plus `glm-5.3`, `kimi-k3`, `deepseek-v4-pro`, and the pi-condense summarizer `openai/gpt-4.1-mini`. Per-model `baseUrl` fix from 2026-09-07 applies to anthropic-messages models. |
| `openai-codex` | OAuth in `agent/auth.json` (gitignored) | subscription | `gpt-5.6-luna`, `-terra`, `-sol` | `gpt-5.6-sol` is the `advisor-pi` default. Tier order cheap → expensive: luna, terra, sol. |
| `llmhub` | Keychain `llmhub` | per token | `gpt-5`, `claude-sonnet-4.5`, `claude-sonnet-4.6`, `claude-opus-4.6` | Only `claude-sonnet-4.6` is enabled. Claude entries carry `compat.cacheControlFormat: "anthropic"`; without it caching silently fails (see `prompt-cache-analysis.md`, the ~€275 incident). Costs are checked against `llmhub-model-pricing.md`. `claude-opus-4.6` is not in that catalog and may not exist on this tenant. |
| `ollama` | none (local) | free | `qwen3:4b-instruct`, `qwen2.5:7b`, `qwen3:8b`, `llama3.1:8b`, `mistral:latest`, `phi4:latest` | `http://localhost:11434/v1`. Compat flags `supportsDeveloperRole: false`, `supportsReasoningEffort: false`. Available for manual use; no longer the summarizer. |

Rule: any Claude model entry with `cacheRead`/`cacheWrite` pricing must carry
`compat.cacheControlFormat: "anthropic"`. Re-check this whenever a Claude model is added.

---

## 4. Cost & Context Controls

| Setting | Value | Purpose |
|---|---|---|
| `showCacheMissNotices` | `true` | Surfaces prompt-cache misses. |
| `compaction.reserveTokens` | `16384` | Headroom before native compaction triggers. |
| `compaction.keepRecentTokens` | `20000` | Recent turns kept verbatim. |
| `retry.provider.maxRetries` | `0` | Leaves usage-limit handling to the provider. |
| `contextPrune` (pi-condense) | enabled, prune on `agent-message`, batched per `turn`, min 1,000 chars | Summarizes finished tool-call batches into recoverable stubs (`context_tree_query`). |
| `contextPrune.summarizerModel` | `openrouter/openai/gpt-4.1-mini` | Cheap hosted summarizer; the local Ollama summarizer was flaky under load. |
| `contextPrune.chainCompression` | rolling window 3, fuse range summary | Compresses long tool chains. |
| `contextPrune.purgeErrors` | cooldown 2 turns, args ≥ 500 chars | Drops failed tool calls once they are stale. |
| `contextPrune.spillThreshold` | 65,536 bytes (2 KB preview) | Large outputs spill to disk. |
| `contextPrune.protectedPaths` | `.env*`, `auth.json`, `.ssh/**`, `.gnupg/**`, `node_modules/**`, `.git/**` | Never pruned or summarized. |
| `cache-warm` package | ≤ 12 pings/hour, stops after 30 min idle | Prevents cold-cache misses after idle gaps. `/cache-warm status`, `/cache-warm off`. |
| `advisor-pi` package | `gpt-5.6-sol`, high thinking, max 5 uses per session branch | Billed separately; do not raise the cap casually. |

Visibility: `/session-stats` for the current session, `scripts/session-usage-report.py`
across all sessions, and the live cost in the `statusline-pi` footer.

---

## 5. Extensions

### Local — `~/.pi/agent/extensions/`

| File | Surface | Purpose |
|---|---|---|
| `permission-gate.ts` | `tool_call` | Confirms or blocks dangerous bash: destructive fs/data ops, `sudo`, curl-into-shell, ssh/scp/rsync, `git push` (esp. force), `gh pr merge`, releases, `npm publish`, global installs, Docker home-dir mounts, Keychain/1Password/cloud-auth reads. Blocks outright in non-interactive mode. |
| `protected-paths.ts` | `tool_call` | Blocks writes to `.env*`, `.git/`, `.ssh/`, `.gnupg/`, `.npmrc`, token/secret/credential filenames and pi's own config files, via write/edit **and** via bash write destinations (`>`, `tee`, `sed -i`). Read-only mentions are allowed. |
| `git-checkpoint.ts` | `turn_start`, `session_before_fork` | `git stash create` per turn when the tree is dirty; `/fork` can restore that state. No-ops outside git and on clean trees. |
| `session-stats.ts` | `/session-stats` | Cost and tokens for the current session by provider/model, including compaction and tool-internal usage; zero-cache-read warning. Works in `-p` mode. |
| `obsidian-sync.ts` | `/obsidian` | Syncs repository markdown into the Obsidian vault (§2). |
| `session-name.ts` | `/session-name` | Human-readable session names for `/resume`. |
| `tool-counter-widget.ts` | `/toolcount`, `/resetcount` | Per-session tool-call counts. |
| `theme-cycler.ts` + `themeMap.ts` | `/theme`, Ctrl+Shift+T / Ctrl+Shift+Q | Cycles the 11 themes in `agent/themes/`; `themeMap.ts` is a shared helper. |
| `welcome-dashboard.ts` | `/welcome` | Startup dashboard; resolves the pi version via `pi --version`. |
| `status-footer.ts.disabled-superseded-by-statusline-pi` | none | Retired 2026-08-29. Do not re-enable alongside `statusline-pi`. |

All extensions import from `@earendil-works/pi-coding-agent` / `@earendil-works/pi-tui`.
Never reintroduce `@mariozechner/*` imports or the non-existent `session_switch` /
`session_fork` events.

### npm packages

| Package | Purpose |
|---|---|
| `pi-web-access` | `web_search`, `fetch_content`, `get_search_content`, `source_check` tools. |
| `pi-condense@2.9.1` | Context-economy layer (§4). |
| `cache-warm` | Cache keep-alive (§4). |
| `pi-lens` | LSP diagnostics, linters, formatters, type checks and ast-grep on every write/edit. Tune per project via `.pi-lens.json`. |
| `@juicesharp/rpiv-ask-user-question` | Structured `ask_user_question` tool. |
| `statusline-pi` | Footer: dir, branch, changed files, PR, live cost, CPU/MEM, context zone, tokens/s, model. |
| `@plannotator/pi-extension` | Browser-based plan and diff annotation before implementation. |
| `advisor-pi` | `advisor` tool for a second opinion from a stronger model (§4). |

Footer budget after the 2026-08-29 declutter: three permanent lines (`statusline-pi`,
`cache-warm`, `advisor-pi`).

MCP is deliberately not configured; `pi-mcp-adapter` was removed as unused.

---

## 6. Web Search — `~/.pi/web-search.json`

```json
{
  "exaApiKey": "!security find-generic-password -ws 'exa-api-key'",
  "braveApiKey": "!security find-generic-password -ws 'brave-api-key'",
  "tavilyApiKey": "!security find-generic-password -ws 'tavily-api-key'",
  "workflow": "summary-review",
  "searxngBaseUrl": "http://127.0.0.1:8888",
  "ssrf": { "allowRanges": ["127.0.0.1/32"] },
  "searchRouting": {
    "providers": ["searxng", "exa", "openai", "brave", "tavily"],
    "fallbackOn": ["unsupported", "transient", "quota", "network", "invalid-response"]
  }
}
```

The daily default is sequential and SearXNG-first: the local, free instance is tried
first, and paid providers are used only on a typed failure. Do not switch the default
back to a parallel fan-out.

For decisions that matter, use `/high-stakes-web-research <topic>`: 2–4 varied queries
across all five providers in parallel, `includeContent: true`, and a `source_check` step.

Local SearXNG: `~/.pi/searxng/docker-compose.yml`, container `pi-searxng`, bound to
`127.0.0.1:8888` only. Start with `cd ~/.pi/searxng && docker compose up -d`.

---

## 7. Prompt Templates — `~/.pi/agent/prompts/`

| Command | Purpose |
|---|---|
| `/high-stakes-web-research <topic>` | Full multi-provider research (§6). |
| `/standup` | Yesterday / Today / Blockers from recent git activity. |
| `/changelog` | Changelog from git history. |

---

## 8. Trust — `~/.pi/agent/trust.json`

```json
{
  "/Users/brooklyn/Workspace/bulliexplorer": true,
  "/Users/brooklyn/Workspace/doc-manager": true,
  "/Users/brooklyn/Workspace/idp-docs": true
}
```

Project trust is **not a sandbox**. pi runs with the user's permissions; the only
isolation layer is `permission-gate.ts` + `protected-paths.ts`, which are regex and
substring checks. `pi-web-access` fetches arbitrary URLs. Container or VM isolation is
still open (§10).

---

## 9. Maintenance Scripts — `~/.pi/scripts/`

| Script | Purpose | Run when |
|---|---|---|
| `smoke-test-extensions.sh` | 10 checks: load with/without tools; permission-gate blocks force-push and a credential read and allows a benign command; protected-paths blocks `.env` via write/edit and via bash redirection and allows a read-only `grep` mentioning `node_modules`; git-checkpoint runs clean in git and non-git dirs. Default model `openrouter/anthropic/claude-sonnet-5`, override with `--model`. | After **any** edit to `agent/extensions/*.ts`. This is the "done" gate. |
| `archive-old-sessions.sh` | Tars + gzips session files older than N days (default 90) to `~/.pi/session-archives/`, verifies before deleting. `--dry-run` supported. | Monthly. |
| `session-usage-report.py` | Cost and tokens by provider/model across live and (`--include-archives`) archived sessions; flags high-input sessions with zero cache reads. `--since`, `--json`. | When checking spend, and after any caching-related change. |

Validate JSON after every manual edit:

```bash
python3 -c "import json; json.load(open('agent/settings.json'))"
python3 -c "import json; json.load(open('agent/models.json'))"
python3 -c "import json; json.load(open('web-search.json'))"
```

The full change checklist lives in `AGENTS.md`.

---

## 10. Known Open Items

`setup-refactor-plan.md` is the maintained list. As of 2026-09-27:

- LLMHub end-to-end cache verification (config fixed 2026-08-29; blocked by the LLMHub project's monthly spend cap).
- `llmhub/claude-opus-4.6` availability unconfirmed (not in the pricing catalog).
- Sandboxing for trusted projects that may process untrusted input.
- Possible upstream pi bug: `applyModelsJson` overrides catalog per-model `baseUrl` (worked around 2026-09-07).
- Subagent / delegation layer: a phased in-house runtime was built 2026-09-23 → 26 and reverted 2026-09-27 as too heavy. Preserved under tag `subagent-attempt-1`. A lighter option using maintained packages is noted in `setup-refactor-plan.md`; nothing is installed.

---

## 11. Documentation Map

| File | Role |
|---|---|
| `README.md` | Overview, layout, new-machine setup. |
| `AGENTS.md` | Rules and change checklist for any agent editing this repo. |
| `Pi-Setup-Guide.md` | This file: as-is reference. |
| `setup-refactor-plan.md` | Append-only decision and implementation log. |
| `prompt-cache-analysis.md` | Root cause of the ~€275 uncached LLMHub session. |
| `llmhub-model-pricing.md` | Authoritative 35-model LLMHub price catalog. |
| `t-mac-upstream-assessment.md` | What to port from `t-mac`, what stays branch-local. |
| `Pi-Setup-Guide.stale-2026-08-29.md` | Superseded version, kept for history. |

## 12. Maintenance of this file

Regenerate this file whenever a change in `setup-refactor-plan.md` materially changes what
is live (packages, models, extensions, guardrails, scripts). Keep history and reasoning in
`setup-refactor-plan.md`; keep this file a current snapshot.
