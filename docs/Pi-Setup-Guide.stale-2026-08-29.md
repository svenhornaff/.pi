# Pi Setup Guide

_As-is documentation of the local `pi` coding agent installation at `~/.pi`._
_Last verified: pi CLI `@earendil-works/pi-coding-agent` v0.84.3._

---

## 1. Overview

This machine runs [pi](https://github.com/earendil-works/pi), a terminal coding
agent, configured under `~/.pi`. `~/.pi` is trusted as a project root itself
(see [Trust](#6-trust)) in addition to being the global agent home.

Directory roles:

| Path | Role |
|---|---|
| `~/.pi/agent/` | **Global agent home** — settings, models, auth, extensions, themes, sessions. Shared across all projects. |
| `~/.pi/.pi/` | **Project-local config** for the `~/.pi` directory itself (since it's trusted as a project). Holds project-scoped packages and web-fetch cache. |

---

## 2. Global Settings — `~/.pi/agent/settings.json`

```json
{
  "defaultProvider": "otc-internal",
  "defaultModel": "GLM-5.2",
  "defaultThinkingLevel": "medium",
  "theme": "dark",
  "hideThinkingBlock": false,
  "quietStartup": true,
  "showCacheMissNotices": true,
  "enabledModels": [
    "ollama/*",
    "otc-internal/*",
    "openrouter/anthropic/claude-sonnet-4.6",
    "openrouter/anthropic/claude-sonnet-5",
    "openrouter/moonshotai/kimi-k2.6",
    "ai-engineer/*",
    "llmhub/*"
  ],
  "compaction": {
    "enabled": true,
    "reserveTokens": 16384,
    "keepRecentTokens": 20000
  },
  "retry": { "enabled": true, "maxRetries": 3 },
  "packages": ["npm:pi-condense"],
  "contextPrune": {
    "enabled": true,
    "pruneOn": "agent-message",
    "summarizerModel": "otc-internal/gpt-oss-120b"
  },
  "extensions": [
    "/Users/A94984797/.pi/agent/extensions/web-search/src/index.ts"
  ],
  "obsidian": {
    "vaultPath": "/Users/A94984797/Documents/ObsidianVault",
    "projectFolder": "PROJECTS",
    "attachmentsFolder": "attachments",
    "include": [
      "README.md", "AGENTS.md", "CLAUDE.md", "SUMMARY.md",
      "docs/**/*.md", "setup-doc/**/*.md", ".pi/**/*.md"
    ],
    "exclude": [".git/**", "node_modules/**", ".DS_Store"],
    "rewriteImageLinks": true
  }
}
```

Key points:

- **Default model**: `GLM-5.2` on the `otc-internal` provider, medium thinking level.
- **Quiet startup** and **cache-miss notices** are on — footer/status noise is minimized but prompt-cache misses are surfaced.
- **`enabledModels`** whitelists which provider/model combos show up in the model picker (wildcards allowed per provider).
- **Compaction** (built-in context compaction) and **contextPrune** (via `pi-condense`, see [§5](#5-packages)) both run — compaction reserves 16k tokens and keeps the most recent 20k tokens verbatim; pruning fires after each agent message and uses a cheap local model (`gpt-oss-120b`) as summarizer.
- **Retry** is enabled, up to 3 attempts on transient failures.
- Only one extension is explicitly registered in `extensions[]` (`web-search`); the rest of `~/.pi/agent/extensions/*.ts` are auto-discovered (see [§4](#4-extensions)).
- **Obsidian sync** is configured to mirror selected markdown docs into an Obsidian vault at `~/Documents/ObsidianVault`.

### Project-local settings — `~/.pi/.pi/settings.json`

```json
{
  "packages": ["npm:pi-mcp-adapter"]
}
```

This is the project-scoped config for `~/.pi` itself. It declares the MCP adapter package but **no MCP servers are currently configured** — `~/.pi/agent/mcp.json` does not exist, so `pi` reports `0/0 servers, 0 tools`. The stray entries in `~/.pi/agent/mcp-cache.json` (context7, sequential-thinking, mermaid, filesystem) are leftover cached tool metadata from a different project's MCP config, not active here.

---

## 3. Providers & Models — `~/.pi/agent/models.json`

Five providers are configured, all using the OpenAI-completions-compatible API shape:

| Provider | Base URL | Auth | Notes |
|---|---|---|---|
| `ollama` | `http://localhost:11434/v1` | static `"ollama"` key | Local models: `llama3.1:8b`, `qwen2.5:7b`, `mistral:latest`, `phi4:latest` |
| `otc-internal` | `https://llm-server.llmhub.t-systems.net/v2` | macOS Keychain (`security find-generic-password -s 'llmhub' -w`) | `Llama-3.3-70B-Instruct`, `gpt-oss-120b`, `GLM-5.2` (1M ctx, default model) |
| `openrouter` | `https://openrouter.ai/api/v1` | Keychain (`openrouter-api-key`) | Claude Opus 5, Claude Sonnet 5, GLM-5.3, Kimi K2.6 |
| `ai-engineer` | T-Systems internal `aie-strive` gateway | Keychain (`ai-engineer-api-key`) | Claude Sonnet 4 (internal proxy); cost fields unconfirmed |
| `llmhub` | `https://llm-server.llmhub.t-systems.net/v2` | Keychain (`llmhub`) | Claude Sonnet 4.6, Claude Opus 4.8, Gemini 2.5 Pro, GPT-5, Qwen2.5-Coder-7B-Base; several cost fields unconfirmed (client-side pricing table, not scrapable) |

**API keys are never stored in plaintext** — `apiKey` fields use the `!<shell command>` syntax to pull secrets live from the macOS Keychain at request time.

Verified working via `pi auth check --provider <name> --no-refresh`:

```
otc-internal   ready
openrouter     ready
ai-engineer    ready
llmhub         ready
ollama         ready
```

> ⚠️ Known gap: `llmhub/claude-opus-4.8`, `llmhub/gemini-2.5-pro`, `llmhub/gpt-5`, and `ai-engineer`'s Claude Sonnet 4 all have `cost: 0` with a `_costNote` flagging unverified pricing. Only affects the cost/usage display, not functionality — confirm via the LLMHub portal or invoice when accuracy matters.

---

## 4. Extensions — `~/.pi/agent/extensions/`

Extensions are TypeScript files auto-discovered from this directory (plus the one path explicitly listed in `settings.json`). All import from `@earendil-works/pi-coding-agent` / `@earendil-works/pi-tui` (kept in sync with the installed CLI package scope).

| Extension | Purpose |
|---|---|
| `git-checkpoint.ts` | Creates a git stash checkpoint (`git stash create`, not pushed to stash list) at the start of every LLM turn, so `/fork` can restore code state to that exact point. |
| `permission-gate.ts` | Prompts for confirmation before risky bash commands (`rm -rf`, `sudo`, `chmod/chown 777`, `git reset --hard`, `DROP/TRUNCATE TABLE`). Blocks them outright in non-interactive (`pi -p`) mode since no UI is available to confirm. |
| `protected-paths.ts` | Blocks write/edit tool calls against sensitive paths (`.env`, lockfiles, vendored deps, etc.) via substring match. |
| `session-name.ts` | Lets you assign a human-readable name to a session (`/session-name <name>`) so `/resume` is easier to navigate with many sessions per project. |
| `status-footer.ts` | Footer status line: `REPO \| git:branch* \| ctx 45k/200k 22% \| model-name` — uses `ctx.ui.setStatus()`, `ctx.getContextUsage()`, and the `model_select` event. |
| `theme-cycler.ts` | Keyboard shortcuts to cycle themes: `Ctrl+Shift+T` forward, `Ctrl+Q` backward; `/theme` opens a picker. |
| `themeMap.ts` | Maps each extension (by filename) to a default theme in `~/.pi/agent/themes/`; extensions call `applyExtensionTheme()` on `session_start` to auto-load their assigned theme. |
| `tool-counter-widget.ts` | Widget showing total tool calls in the session, broken down by tool type. |
| `welcome-dashboard.ts` | Custom startup dashboard (config in `welcome-dashboard-config.json`). |
| `obsidian-sync.ts` | Syncs configured markdown files into the Obsidian vault (see `obsidian` block in settings.json); also rewrites image links. |
| `web-search/` (`@svenhornaff/web-search` v1.6.0) | Full web search + content extraction tool (Exa, Brave, Tavily providers) plus `web_fetch`/`get_fetch_content`. Explicitly registered in `settings.json` `extensions[]`. |

Reload extensions after editing with `/reload` inside a session.

---

## 5. Packages

Two npm-based pi packages are installed:

- **User-scoped** (`~/.pi/agent/npm/`): `pi-condense` (`^2.9.1`) — the context-economy layer referenced by `contextPrune` in settings. It replaces finished tool-call batches with short recoverable summaries once a threshold is hit, keeping long sessions cheap without busting provider prompt caches. Summaries can always be pulled back verbatim via `context_tree_query`.
- **Project-scoped** (`~/.pi/.pi/npm/`, applies to `~/.pi` as a project): `pi-mcp-adapter` — the MCP client/adapter package. Declared but currently has **no MCP servers configured** (no `mcp.json` present).

Check installed packages any time with:

```bash
pi list
```

---

## 6. Trust — `~/.pi/agent/trust.json`

```json
{
  "/Users/A94984797": true,
  "/Users/A94984797/Workspace/cv-review/.pi": true,
  "/Users/A94984797/Workspace/idp_contracts": true,
  "/Users/A94984797/Workspace/pi-tools": true
}
```

Trusted directories where `pi` will run without an interactive trust prompt. All four paths were verified to exist on disk.

---

## 7. Themes — `~/.pi/agent/themes/`

Eleven custom theme JSON files, selectable via `/theme` or the `theme-cycler` extension:

`catppuccin-mocha`, `cyberpunk`, `dracula`, `everforest`, `gruvbox`, `midnight-ocean`, `nord`, `ocean-breeze`, `rose-pine`, `synthwave`, `tokyo-night`

The active global default (`settings.json` → `"theme": "dark"`) is a **built-in** theme, not one of the custom ones above — this is intentional, not a mismatch.

---

## 8. Prompts — `~/.pi/agent/prompts/`

Reusable prompt templates: `changelog.md`, `model-status.md`, `standup.md`.

---

## 9. Auth — `~/.pi/agent/auth.json` + macOS Keychain

- `auth.json` holds any OAuth-based credentials (auto-refreshed by `pi auth check` unless `--no-refresh` is passed).
- API-key-based providers (`otc-internal`, `openrouter`, `ai-engineer`, `llmhub`) fetch their keys live from the **macOS Keychain** via `security find-generic-password`, referenced inline in `models.json` using the `!<command>` secret syntax — nothing sensitive is stored in plaintext config.

Verify all providers at once:

```bash
for p in otc-internal openrouter ai-engineer llmhub ollama; do
  echo "=== $p ===" ; pi auth check --provider "$p" --no-refresh
done
```

---

## 10. Sessions

Stored under `~/.pi/agent/sessions/`, one subdirectory per project, JSONL transcripts inside. No active issues; large accumulated history (project `pi-tools` alone was ~77MB at last check) is a candidate for periodic manual cleanup but not required for correct operation.

---

## 11. Bundled Binaries

`~/.pi/agent/bin/` ships vendored `fd` and `rg` (ripgrep) binaries used by the agent's built-in search tools, independent of any system-installed versions.

---

## 12. Known Non-Issues (verified, not bugs)

- **`mcp` reports `0/0 servers, 0 tools` globally** — expected, no `~/.pi/agent/mcp.json` exists; `pi-mcp-adapter` is installed but unconfigured at the global/project level.
- **`mcp-cache.json` lists context7/sequential-thinking/mermaid/filesystem** — stale cached metadata from a different project's MCP config; harmless.
- **Theme `dark` isn't in the custom themes list** — it's a pi built-in, working as intended.
- **Cost `0` on some LLMHub/ai-engineer models** — pricing unconfirmed upstream (JS-rendered pricing pages), display-only impact.

---

## 13. Quick Health Check

```bash
pi --version                                   # confirm CLI version
pi list                                        # installed packages (user + project scope)
for p in otc-internal openrouter ai-engineer llmhub ollama; do
  pi auth check --provider "$p" --no-refresh
done
pi -p "just say ok, no tools" --model ollama/llama3.1:8b --verbose   # sanity-check extension loading
```

All of the above were run and passed at the time this guide was written.
