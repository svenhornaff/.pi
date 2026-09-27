# ~/.pi — Personal Pi Coding-Agent Configuration

This is the global configuration home for [pi](https://github.com/earendil-works/pi)
(`@earendil-works/pi-coding-agent`), covering models, extensions, prompt
templates, web search, and local infrastructure (SearXNG) used across all
projects on this machine.

It is tracked in git so config changes are diffable and revertible — see
[Security & what's excluded](#security--whats-excluded) for what deliberately
stays out of version control.

## Layout

```
agent/
  settings.json        Core pi settings: default model, compaction, retry,
                        contextPrune (pi-condense), Obsidian sync, packages
  models.json           Provider/model definitions & pricing (openrouter,
                        llmhub, ollama, openai-codex) — no raw API keys,
                        only macOS Keychain references
  trust.json            Per-project trust decisions
  auth.json             Provider credentials (gitignored, never committed)
  models-store.json     Cached upstream model metadata (gitignored)
  extensions/           Global pi extensions — see below
  prompts/              Global prompt templates (/name in the editor)
  themes/                Custom TUI themes
  sessions/              Session transcripts (gitignored — can contain file
                          contents, command output, fetched web content)
web-search.json         Web search provider config & routing policy
searxng/                Local SearXNG instance (docker-compose + config)
scripts/                Maintenance scripts (see below)
setup-refactor-plan.md  Living decision log for this config (read this for
                        the "why" behind non-obvious choices)
llmhub-model-pricing.md Reference pricing catalog for the LLMHub provider
prompt-cache-analysis.md Root-cause writeup of a real prompt-caching cost
                        incident that shaped several settings below
```

## Setup on a new machine

```bash
git clone git@github.com:svenhornaff/.pi.git ~/.pi
cd ~/.pi/agent && npm install --prefix extensions   # extension deps
```

Then populate secrets (never committed):
- `agent/auth.json` — provider credentials, or let `pi auth login` create it
- API keys referenced from `models.json`/`web-search.json` via
  `!security find-generic-password -ws '<service>'` must exist in the macOS
  Keychain under those service names (e.g. `openrouter-api-key`, `llmhub`)

Bring up local search infra (optional, used by the default web-search routing):

```bash
cd searxng && docker compose up -d
```

## Key design decisions

- **Default model**: `openrouter/anthropic/claude-sonnet-5` at medium thinking
  — a deliberate cost/capability balance, not the most powerful option
  available. See `setup-refactor-plan.md` for the reasoning.
- **Context pruning** (`pi-condense`, via `contextPrune` in `settings.json`)
  keeps long sessions affordable by summarizing finished tool-call batches
  into recoverable stubs, retrievable with `context_tree_query`. The
  summarizer model is a cheap hosted model (`openrouter/openai/gpt-4.1-mini`),
  chosen after a local Ollama summarizer proved too flaky under load.
- **Prompt caching**: LLMHub Claude models require
  `compat.cacheControlFormat: "anthropic"` in `models.json` to actually use
  provider prompt caching. This was *not* the default and its absence
  produced a real, expensive incident — see `prompt-cache-analysis.md`.
- **Cache keep-alive**: [`cache-warm`](https://www.npmjs.com/package/cache-warm)
  (npm, `luongnv89/pi-extensions`) sends a tiny hidden ping shortly before
  the provider's cache TTL expires so an idle gap or a slow turn doesn't
  cause a cold-cache miss on the next real message — the exact failure
  mode described in `prompt-cache-analysis.md`. On by default, rate-limited
  to 12 pings/hour, and auto-stops after 30 minutes idle so a forgotten
  session doesn't bill overnight. Tune with `/cache-warm duration <Nm|Nh|forever>`,
  disable with `/cache-warm off`, inspect with `/cache-warm status` /
  `/cache-warm metrics`.
- **Web search** defaults to a cheap, sequential, SearXNG-first routing
  policy (`web-search.json` → `searchRouting`) for everyday queries. For
  research that genuinely warrants full multi-provider coverage, use the
  `/high-stakes-web-research` prompt template instead of changing the
  global default.
- **MCP**: deliberately not configured. A previous `pi-mcp-adapter`
  installation was removed as unused, stale, and cross-machine cache debris.
  Add it back deliberately if a real use case shows up.

## Extensions

### Local (`agent/extensions/*.ts`)

| Extension | Purpose |
|---|---|
| `permission-gate.ts` | Prompts/blocks dangerous bash (force-push, `rm -rf`, credential reads, network egress, package publishing) |
| `protected-paths.ts` | Blocks writes/edits to secrets, pi's own config files, and `.env*`/`.ssh/`/`.gnupg/` — including via bash redirection, not just the write/edit tools |
| `git-checkpoint.ts` | Auto-checkpoints (git stash create) before risky turns; skips cleanly on non-git dirs or clean trees |
| `session-stats.ts` | `/session-stats` — cumulative token usage & cost for the current session, broken out by model, with fresh-vs-cached input and a zero-cache-read warning |
| `obsidian-sync.ts` | Syncs session summaries into an Obsidian vault |
| `tool-counter-widget.ts`, `theme-cycler.ts`, `welcome-dashboard.ts`, `session-name.ts` | TUI ergonomics |
| `status-footer.ts.disabled-superseded-by-statusline-pi` | Retired 2026-08-29 — superseded by the `statusline-pi` npm package below, which covers the same ground plus CPU/MEM, tokens/sec, PR number, and live cost. Kept on disk, renamed, for reference. |

### npm packages (`agent/settings.json` → `packages`)

| Package | Purpose |
|---|---|
| `pi-web-access` | Fetch/browse tools for the model |
| `pi-condense` | Context-economy layer — recoverable pruning of finished tool-call batches (see `contextPrune` settings above) |
| `cache-warm` | Keep-alive pings against prompt-cache TTL expiry (see above) |
| `pi-lens` | Real-time LSP diagnostics, linters, formatters, type-checking, and structural (ast-grep) analysis on every write/edit — project-tunable via `.pi-lens.json` if a given repo's tooling makes it too noisy |
| `@juicesharp/rpiv-ask-user-question` | Gives the model a structured `ask_user_question` tool — typed multiple-choice/free-text dialog instead of silently guessing on ambiguous decisions |
| `statusline-pi` | Compact footer: dir, branch, changed files, PR #, live estimated session cost, CPU/MEM, context-remaining zone, tokens/sec, model |
| `@plannotator/pi-extension` | Local browser-based plan/diff/PR review surface — annotate plans and code before implementation, feedback flows back to the model |
| `advisor-pi` | Gives the model an `advisor` tool to consult a separate higher-capability model (default `openai-codex/gpt-5.6-sol`, high thinking) for planning/risk-review on complex tasks, capped at 5 uses/session-branch by default — each call is billed separately, so this is deliberately budget-limited, not unlimited |

A regression check for these lives in `scripts/smoke-test-extensions.sh` —
run it after editing any extension.

## Scripts (`scripts/`)

| Script | Purpose |
|---|---|
| `smoke-test-extensions.sh` | Verifies the guardrail extensions still block/allow the right things |
| `archive-old-sessions.sh` | Archives session transcripts older than 90 days (`--dry-run` supported) |
| `session-usage-report.py` | Aggregates historical cost/tokens by provider/model across all sessions; flags zero-cache-read sessions that indicate a caching misconfiguration |

## Security & what's excluded

Never committed (see `.gitignore`): `agent/auth.json`, `agent/models-store.json`,
session transcripts, timestamped `.bak` backups, installed `node_modules`,
and SearXNG runtime data. API keys are referenced indirectly via macOS
Keychain lookups (`!security find-generic-password ...`) in `models.json`
and `web-search.json` — the config files themselves contain no secrets.

This config directory has no sandbox/container isolation of its own; trust
decisions in `agent/trust.json` grant real tool access to the listed project
directories. Treat it accordingly if any trusted project processes
untrusted external input.

## License

[NCSAL](LICENSE) — non-commercial use, source-available. Contact the author
for commercial licensing.
