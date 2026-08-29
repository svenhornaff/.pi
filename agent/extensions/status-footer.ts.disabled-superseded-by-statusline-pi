/**
 * Status Footer Extension
 *
 * Shows a compact status line in the footer area:
 *   REPO | git:branch* | ctx 45k/200k 22% | claude-sonnet
 *
 * Uses ctx.ui.setStatus() for footer display, ctx.getContextUsage()
 * for accurate token/context data, and the model_select event for
 * live model-name tracking — no internal API access required.
 *
 * Usage:
 *   Place in ~/.pi/agent/extensions/ for auto-discovery
 *   Use /reload to hot-reload after changes
 *
 * Commands:
 *   /footer-status  - Show current footer info as a notification
 */

import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

// ---------------------------------------------------------------------------
// Git helpers — lightweight caches scoped inside the extension function
// ---------------------------------------------------------------------------

function createGitCache() {
  const repoCache = new Map<string, string | null>();
  const branchCache = new Map<string, string | null>();
  const dirtyCache = new Map<string, boolean>();

  function invalidate() {
    branchCache.clear();
    dirtyCache.clear();
    // repo root rarely changes, keep it cached
  }

  function getRepoName(cwd: string): string | null {
    if (repoCache.has(cwd)) return repoCache.get(cwd)!;
    try {
      const root = execSync("git rev-parse --show-toplevel", {
        cwd,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();
      const name = path.basename(root);
      repoCache.set(cwd, name);
      return name;
    } catch {
      repoCache.set(cwd, null);
      return null;
    }
  }

  function getBranch(cwd: string): string | null {
    if (branchCache.has(cwd)) return branchCache.get(cwd)!;
    try {
      const branch = execSync("git rev-parse --abbrev-ref HEAD", {
        cwd,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();
      // "HEAD" means detached — try to get short SHA instead
      if (branch === "HEAD") {
        try {
          const sha = execSync("git rev-parse --short HEAD", {
            cwd,
            encoding: "utf8",
            stdio: ["ignore", "pipe", "ignore"],
          }).trim();
          const detached = `:${sha}`;
          branchCache.set(cwd, detached);
          return detached;
        } catch {
          branchCache.set(cwd, null);
          return null;
        }
      }
      branchCache.set(cwd, branch);
      return branch;
    } catch {
      branchCache.set(cwd, null);
      return null;
    }
  }

  function isDirty(cwd: string): boolean {
    if (dirtyCache.has(cwd)) return dirtyCache.get(cwd)!;
    try {
      const output = execSync("git status --porcelain", {
        cwd,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();
      const dirty = output.length > 0;
      dirtyCache.set(cwd, dirty);
      return dirty;
    } catch {
      dirtyCache.set(cwd, false);
      return false;
    }
  }

  return { invalidate, getRepoName, getBranch, isDirty };
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

function formatNumber(n: number): string {
  if (!n || Number.isNaN(n)) return "0";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function formatPercent(used: number, max: number): string {
  if (!used || !max || max <= 0) return "0%";
  return `${Math.round((used / max) * 100)}%`;
}

function buildProgressBar(percent: number, width: number = 12): string {
  const clamped = Math.max(0, Math.min(100, percent));
  const filled = Math.round((clamped / 100) * width);
  const empty = width - filled;
  const bar = "█".repeat(filled) + "░".repeat(empty);
  return `[${bar}]`;
}

// ---------------------------------------------------------------------------
// Cost helpers — read ~/.pi/agent/models.json and resolve per-model pricing
// ---------------------------------------------------------------------------

interface ModelCost {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

interface ModelsConfig {
  providers: Record<string, { models: Array<{ id: string; cost?: ModelCost }> }>;
}

function loadModelsConfig(): ModelsConfig | null {
  try {
    const configPath = path.join(os.homedir(), ".pi/agent/models.json");
    const raw = readFileSync(configPath, "utf8");
    return JSON.parse(raw) as ModelsConfig;
  } catch {
    return null;
  }
}

function findModelCost(config: ModelsConfig | null, modelId: string): ModelCost | null {
  if (!config || !modelId) return null;
  for (const provider of Object.values(config.providers)) {
    const model = provider.models.find((m) => m.id === modelId);
    if (model?.cost) return model.cost;
  }
  return null;
}

function formatCost(cost: number): string {
  if (cost === 0) return "$0";
  const perMillion = cost * 1_000_000;
  if (perMillion >= 1) return `$${perMillion.toFixed(2)}`;
  if (perMillion >= 0.01) return `$${perMillion.toFixed(3)}`;
  return `$${perMillion.toFixed(4)}`;
}

function formatModelCost(cost: ModelCost | null): string {
  if (!cost) return "";
  return `${formatCost(cost.input)}/${formatCost(cost.output)}`;
}

function getCompactModelName(model?: string): string {
  if (!model) return "unknown";
  const lower = model.toLowerCase();

  if (lower.includes("claude") && lower.includes("sonnet")) return "claude-sonnet";
  if (lower.includes("claude") && lower.includes("opus")) return "claude-opus";
  if (lower.includes("claude") && lower.includes("haiku")) return "claude-haiku";
  if (lower.includes("gpt-5")) return "gpt-5";
  if (lower.includes("gpt-4")) return "gpt-4";
  if (lower.includes("gemini") && lower.includes("pro")) return "gemini-pro";
  if (lower.includes("gemini") && lower.includes("flash")) return "gemini-flash";
  if (lower.includes("kimi")) return "kimi";
  if (lower.includes("qwen")) return "qwen";
  if (lower.includes("deepseek")) return "deepseek";

  return model.length > 18 ? model.slice(0, 18) + "…" : model;
}

// ---------------------------------------------------------------------------
// Footer builder
// ---------------------------------------------------------------------------

function resolveModelName(ctx: ExtensionContext, cachedName: string): string {
  // Prefer cached name from model_select events
  if (cachedName !== "unknown") return cachedName;
  // Fallback: read directly from ctx.model (available on every render)
  if (ctx.model) return getCompactModelName(ctx.model.id);
  return "unknown";
}

function buildFooter(
  ctx: ExtensionContext,
  git: ReturnType<typeof createGitCache>,
  modelName: string,
  modelCost: string,
): string {
  const cwd = process.cwd();

  // Git info
  const repo = git.getRepoName(cwd);
  const branch = git.getBranch(cwd);
  const dirty = git.isDirty(cwd);

  const repoPart = (repo ?? path.basename(cwd)).toUpperCase();
  const gitPart = branch ? `git:${branch}${dirty ? "*" : ""}` : "";

  // Token / context info via the official API (ctx.getContextUsage)
  const usage = ctx.getContextUsage();
  let ctxPart: string;

  if (usage) {
    const tokens = usage.tokens ?? 0;
    const limit = usage.contextWindow ?? 0;
    const percent = usage.percent ?? (limit > 0 ? (tokens / limit) * 100 : 0);
    const bar = buildProgressBar(Math.round(percent));
    ctxPart = `ctx ${formatNumber(tokens)}/${formatNumber(limit)} ${bar} ${Math.round(percent)}%`;
  } else {
    ctxPart = "ctx -/-";
  }

  const resolvedModel = resolveModelName(ctx, modelName);
  const modelPart = modelCost ? `${resolvedModel} ${modelCost}` : resolvedModel;
  const parts = [repoPart, gitPart, ctxPart, modelPart].filter(Boolean);
  return parts.join(" | ");
}

// ---------------------------------------------------------------------------
// Extension entry point
// ---------------------------------------------------------------------------

export default function statusFooterExtension(pi: ExtensionAPI) {
  const git = createGitCache();
  const STATUS_KEY = "status-footer";
  const modelsConfig = loadModelsConfig();

  // Model name is tracked via the model_select event (public API).
  // Starts as "unknown" until the first model_select fires on session restore
  // or user action (/model, Ctrl+P).
  let cachedModelName = "unknown";
  let cachedModelId = "";

  function refresh(ctx: ExtensionContext) {
    try {
      // Lazily update cached model name from ctx.model if still unknown
      if ((cachedModelName === "unknown" || !cachedModelId) && ctx.model) {
        cachedModelName = getCompactModelName(ctx.model.id);
        cachedModelId = ctx.model.id;
      }
      const cost = findModelCost(modelsConfig, cachedModelId || ctx.model?.id || "");
      const costStr = formatModelCost(cost);
      ctx.ui.setStatus(STATUS_KEY, buildFooter(ctx, git, cachedModelName, costStr));
    } catch {
      // Footer should never crash the session
    }
  }

  // --- Lifecycle events ---

  // Session start: initial render + invalidate git caches
  pi.on("session_start", async (_event, ctx) => {
    git.invalidate();
    refresh(ctx);
  });

  // Model changed (via /model, Ctrl+P, or session restore) — update name immediately.
  // event.model.id is the public, stable model identifier.
  pi.on("model_select", async (event, ctx) => {
    cachedModelName = getCompactModelName(event.model.id);
    cachedModelId = event.model.id;
    refresh(ctx);
  });

  // After each agent turn completes — context usage is updated
  pi.on("agent_end", async (_event, ctx) => {
    refresh(ctx);
  });

  // After each tool execution — context may have grown
  pi.on("tool_result", async (_event, ctx) => {
    refresh(ctx);
  });

  // After each full message from the model
  pi.on("message_end", async (_event, ctx) => {
    refresh(ctx);
  });

  // NOTE: session_switch/session_fork are not real pi events (no-ops previously).
  // session_start already fires on resume/new/fork with event.reason distinguishing
  // them, and it already invalidates git + refreshes above, so switching sessions is covered.

  // --- Commands ---

  pi.registerCommand("footer-status", {
    description: "Show current footer info as a notification",
    handler: async (_args, ctx) => {
      const cwd = process.cwd();
      const usage = ctx.getContextUsage();
      const tokens = usage?.tokens ?? 0;
      const limit = usage?.contextWindow ?? 0;   // ← correct field name
      const cost = findModelCost(modelsConfig, cachedModelId || ctx.model?.id || "");
      const costStr = cost
        ? `input ${formatCost(cost.input)}/1M · output ${formatCost(cost.output)}/1M`
        : "not configured";

      const lines = [
        `cwd: ${cwd}`,
        `repo: ${git.getRepoName(cwd) ?? "-"}`,
        `branch: ${git.getBranch(cwd) ?? "-"}${git.isDirty(cwd) ? " (dirty)" : ""}`,
        `context: ${formatNumber(tokens)} / ${formatNumber(limit)} (${formatPercent(tokens, limit)})`,
        `model: ${cachedModelName}`,
        `cost: ${costStr}`,
      ];

      ctx.ui.notify(lines.join("\n"), "info");
    },
  });
}
