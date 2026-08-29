# AGENTS.md — ~/.pi (global pi coding-agent config)

## Project overview

This is the **global configuration home** for `pi` (`@earendil-works/pi-coding-agent`)
on this machine — not a library, not a deployable app. It defines the
models, guardrail extensions, prompt templates, and web-search policy that
every pi session on this machine inherits by default. Changes here affect
*every* project run with pi, not just one repo — treat edits accordingly.

TypeScript extensions, no build step (pi loads `.ts` directly).

Workspace layout:

```text
~/.pi/
├── agent/
│   ├── settings.json     # default model, compaction, retry, contextPrune, packages
│   ├── models.json        # provider/model definitions & pricing (no raw keys)
│   ├── trust.json         # per-project trust decisions
│   ├── auth.json          # provider credentials — gitignored, never committed
│   ├── models-store.json  # cached upstream model metadata — gitignored
│   ├── extensions/        # global pi extensions — see "Source layout"
│   ├── prompts/           # global prompt templates (/name)
│   ├── themes/
│   └── sessions/          # transcripts — gitignored, may contain file/command content
├── web-search.json        # web search provider config & routing policy
├── searxng/                # local SearXNG (docker-compose + config)
├── scripts/                 # maintenance scripts — see "Commands"
├── setup-refactor-plan.md   # living decision log — read before changing defaults
├── llmhub-model-pricing.md  # reference pricing catalog (LLMHub provider)
└── prompt-cache-analysis.md # root-cause writeup of a real cost incident
```

## Setup

```bash
cd agent/extensions && npm install    # extension deps (@ifi/oh-pi-themes)
```

Secrets are never committed. `agent/auth.json` is created by `pi auth login`.
API keys referenced from `agent/models.json` / `web-search.json` via
`!security find-generic-password -ws '<service>'` must exist in the macOS
Keychain under that service name (e.g. `openrouter-api-key`, `llmhub`) —
config files themselves must never contain a raw key.

## Commands

There is no `npm run check` here — this is a config directory, not a
package. The equivalent gate before considering any extension change done:

```bash
./scripts/smoke-test-extensions.sh   # guardrail extensions still block/allow the right things
```

Other scripts, run standalone as needed (not part of the "done" gate):

```bash
./scripts/archive-old-sessions.sh --dry-run   # preview session archival (90-day default)
./scripts/session-usage-report.py             # cost/token report across sessions, flags zero-cache-read
```

Validate JSON config files after any manual edit — a syntax error here
breaks every pi invocation on the machine, not just one project:

```bash
python3 -c "import json; json.load(open('agent/settings.json'))"
python3 -c "import json; json.load(open('agent/models.json'))"
python3 -c "import json; json.load(open('web-search.json'))"
```

## Source layout

- `agent/extensions/permission-gate.ts` — prompts/blocks dangerous bash
  (force-push, `rm -rf`, credential reads, network egress, package
  publishing). Regex/substring-based, not a sandbox — see Rules below.
- `agent/extensions/protected-paths.ts` — blocks writes/edits to secrets,
  pi's own config files, `.env*`, `.ssh/`, `.gnupg/`, including via bash
  redirection (`>`, `tee`, `sed -i`), not just the write/edit tools.
- `agent/extensions/git-checkpoint.ts` — auto-checkpoints before risky
  turns via `git stash create`; must no-op cleanly on non-git dirs and
  skip work on a clean tree (cost guard — do not remove the clean-tree check).
- `agent/extensions/session-stats.ts` — `/session-stats`: cumulative
  cost/tokens for the current session, fresh-vs-cached input split,
  zero-cache-read warning. Must work in `-p`/non-TUI mode (`ctx.hasUI`
  false) via a `console.log` fallback, not only `ctx.ui.notify`.
- `agent/extensions/obsidian-sync.ts`, `status-footer.ts`,
  `tool-counter-widget.ts`, `theme-cycler.ts`, `themeMap.ts`,
  `welcome-dashboard.ts`, `session-name.ts` — TUI/workflow ergonomics.
- `agent/models.json` — provider definitions. Claude models behind the
  `llmhub` provider **must** carry `compat.cacheControlFormat: "anthropic"`
  or prompt caching silently fails and every token is billed at full
  price — this caused a real ~€275 incident (`prompt-cache-analysis.md`).
- `agent/settings.json` `contextPrune` — the `pi-condense` config. The
  summarizer model must be a model that is reliably available; a flaky
  local Ollama model here causes constant "summarizer failing, falling
  back to session model" warnings and defeats the point of a cheap
  summarizer. Prefer a cheap hosted model.
- `web-search.json` `searchRouting` — the cheap, sequential, SearXNG-first
  default for everyday queries. Do not change this back to a multi-provider
  fan-out as the *default*; use the `/high-stakes-web-research` prompt
  template (`agent/prompts/`) instead when full multi-provider coverage is
  actually warranted.

## Code style

- No build step; pi loads extension `.ts` files directly.
- No dependencies beyond what `agent/extensions/package.json` already
  lists without a concrete need.
- Import from `@earendil-works/pi-coding-agent` / `@earendil-works/pi-tui`.
  **Never** reintroduce `@mariozechner/*` imports — that scope no longer
  exists on disk and every extension in this repo was previously broken
  by it. Grep before committing:
  ```bash
  grep -rn "mariozechner" agent/extensions/*.ts
  ```
- Use only documented pi extension events. `session_switch` and
  `session_fork` are **not real events** — they were dead code in this
  repo before removal. Use `session_start` with `event.reason`
  (`"new" | "resume" | "fork"`) and `session_before_switch` /
  `session_before_fork` for pre-switch hooks instead.

## Testing

- No `node:test` suite. The regression gate is
  `scripts/smoke-test-extensions.sh`, which exercises the guardrail
  extensions end-to-end (blocks force-push, blocks credential reads,
  allows benign commands, blocks `.env` writes via both the write/edit
  tools *and* bash redirection, no-ops cleanly in git and non-git dirs).
- Any change to `permission-gate.ts` or `protected-paths.ts` needs a new
  case added to the smoke test in the same change — this project has a
  history of a bash-redirection bypass slipping past a tool-only check.
- Test scratch work in `/tmp/`, never inside a real project directory —
  see Rules below.

## Public surface — keep it in sync

The public surface is every `pi.registerCommand`, `pi.registerTool`, and
`ctx.ui` widget id registered across `agent/extensions/*.ts`, plus every
setting key documented in `README.md` and `setup-refactor-plan.md`.

Before treating any extension change as done:

- Diff the surface against what it was before the change (new/removed/
  renamed command, tool, or settings key).
- If something changed: update `README.md`'s extension/script table, and
  add an entry to `setup-refactor-plan.md`'s implementation log stating
  the change explicitly — a removal is stated as a removal, not omitted.

## Decision-log conventions (`setup-refactor-plan.md`)

- One entry per change, written when the change is made, with what was
  found, what was done, and how it was verified (command output, not
  just a claim).
- Past entries are not rewritten. If one turns out wrong or incomplete,
  add a new entry correcting it and reference the original — this
  document is a history of what was actually done, not just current state.
- Every fix claimed in this log must be re-verifiable by running the
  same check again — prefer "ran X, got Y" over "should work now."

## Commit and versioning

- `.gitignore` excludes secrets (`agent/auth.json`, `agent/models-store.json`),
  session transcripts (`agent/sessions/`, `session-archives/`),
  `*.bak*` backups, installed `node_modules/`, and SearXNG runtime data.
  Verify before every commit that touches config, not just once:
  ```bash
  git status --short   # confirm no auth.json / *-store.json / sessions/ / .bak staged
  grep -rn "apiKey" agent/models.json web-search.json   # must show only
                                                          # `!security find-generic-password`
                                                          # references, never a raw key
  ```
- Take a timestamped backup (`cp file file.bak.$(date +%Y%m%d-%H%M%S)`,
  outside the repo or gitignored) before editing any live config file by
  script/tool rather than by hand — these files break every pi session on
  the machine if malformed, and git history alone is a slower recovery
  path than a local `.bak` during the edit itself.

## PR / change checklist

1. Config or extension change made.
2. JSON configs validated (`python3 -c "import json; json.load(...)"`).
3. `scripts/smoke-test-extensions.sh` green, if extensions touched.
4. Public surface diffed — `README.md` and `setup-refactor-plan.md` updated
   if it changed.
5. `git status --short` checked for accidental secrets/session/backup
   staging before commit.
6. Change actually re-verified with a real command run, not assumed.

## Rules

1. Never work outside this workspace (`~/.pi`) for anything related to
   this config; if a `tmp`/scratch directory is needed for testing
   extension behavior, use `/tmp/`, never a real trusted project
   directory and never a path this repo's own `protected-paths.ts` guards.
2. Never commit a raw API key or secret. Every credential must be a
   Keychain reference (`!security find-generic-password ...`), resolved
   at runtime, not stored in a tracked file.
3. Never remove or weaken `permission-gate.ts` / `protected-paths.ts`
   coverage without adding an equivalent or stronger check — this repo's
   guardrails are the only isolation layer in front of the trusted
   projects listed in `agent/trust.json`; there is no sandbox underneath.
4. Treat every change to `agent/settings.json` or `agent/models.json` as
   machine-wide until proven otherwise — validate JSON and smoke-test
   before considering the change done, not after noticing something broke.
