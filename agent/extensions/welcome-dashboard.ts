import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

// ── Types & Constants ─────────────────────────────────────────────────────────

type Theme = { fg: (color: string, text: string) => string; bold: (text: string) => string };

const HOME = process.env.HOME || "";
const GLOBAL_AGENT_DIR = path.join(HOME, ".pi", "agent");
const CONFIG_PATH = path.join(GLOBAL_AGENT_DIR, "welcome-dashboard-config.json");

// ── Helpers ───────────────────────────────────────────────────────────────────

// Resolve the running pi version by shelling out to `pi --version` instead of
// hardcoding an install path — package name/location has changed before
// (@mariozechner/pi-coding-agent → @earendil-works/pi-coding-agent) and will
// likely change again.
function getPiVersion(): string {
  try {
    return execFileSync("pi", ["--version"], { encoding: "utf8", timeout: 2000 }).trim() || "dev";
  } catch {
    return "dev";
  }
}

function readEnabledConfig(): boolean {
  try {
    if (!existsSync(CONFIG_PATH)) return true;
    return (JSON.parse(readFileSync(CONFIG_PATH, "utf8")) as { enabled?: boolean }).enabled !== false;
  } catch {
    return true;
  }
}

function writeEnabledConfig(value: boolean): void {
  try {
    writeFileSync(CONFIG_PATH, JSON.stringify({ enabled: value }, null, 2) + "\n", "utf8");
  } catch {}
}

function hasConversation(ctx: ExtensionContext): boolean {
  return ctx.sessionManager.getBranch().some((entry: unknown) => {
    const e = entry as { type?: string; message?: { role?: string } };
    if (e.type !== "message") return false;
    const role = e.message?.role;
    return role === "user" || role === "assistant" || role === "toolResult";
  });
}

function formatPath(p: string): string {
  return HOME && p.startsWith(HOME) ? `~${p.slice(HOME.length) || "/"}` : p;
}

function padTo(text: string, width: number): string {
  const w = visibleWidth(text);
  if (w >= width) return truncateToWidth(text, width, "");
  return text + " ".repeat(width - w);
}

function modelLabel(ctx: ExtensionContext): string {
  const provider = ctx.model?.provider || "?";
  const model = ctx.model?.id || "?";
  return `${provider}/${model}`;
}

// ── Pi Logo ───────────────────────────────────────────────────────────────────

const PI_LOGO = [
  " ██████  ",
  " ██  ██  ",
  " ████  ██",
  " ██    ██",
];

// ── Tips ──────────────────────────────────────────────────────────────────────

const TIPS: [string, string][] = [
  ["Ctrl+L", "switch model"],
  ["Shift+Tab", "cycle thinking"],
  ["Ctrl+G", "external editor"],
  ["/resume", "resume last session"],
  ["@file", "attach file to prompt"],
  ["!cmd", "run shell command inline"],
];

// ── Render ────────────────────────────────────────────────────────────────────

function buildDashboard(
  theme: Theme,
  version: string,
  model: string,
  thinking: string,
  cwd: string,
  width: number,
): string[] {
  const b = (s: string) => theme.fg("accent", s);
  const dim = (s: string) => theme.fg("dim", s);
  const muted = (s: string) => theme.fg("muted", s);

  const inner = Math.max(50, width - 2);
  const leftW = Math.max(20, Math.floor(inner / 3));
  const rightW = inner - leftW - 1;

  // ── Left panel ──
  const left: string[] = [
    "",
    ` ${theme.bold("Welcome back brooklyn42!")}`,
    "",
    ...PI_LOGO.map((l) => ` ${b(l)}`),
    "",
    ` ${model}`,
    `  ${formatPath(cwd)}`,
    "",
  ];

  // ── Right panel ──
  const right: string[] = [
    ` ${b(theme.bold("Tips"))}`,
    ` ${dim("─".repeat(Math.max(0, rightW - 2)))}`,
  ];
  for (const [key, desc] of TIPS) {
    right.push(` ${padTo(b(key), 14)} ${muted(desc)}`);
  }
  right.push("");
  right.push(` ${b(theme.bold("Thinking"))}: ${thinking}`);
  right.push("");

  // ── Borders ──
  const vTitle = ` pi v${version} `;
  const leftFill = Math.max(0, leftW - visibleWidth(vTitle) - 1);
  const top = b("┌") + b(`─${vTitle}`) + b("─".repeat(leftFill)) + b("┬") + b("─".repeat(rightW)) + b("┐");
  const bot = b("└") + b("─".repeat(leftW)) + b("┴") + b("─".repeat(rightW)) + b("┘");

  const rows = Math.max(left.length, right.length);
  const lines: string[] = [top];
  for (let i = 0; i < rows; i++) {
    const l = padTo(truncateToWidth(left[i] ?? "", leftW), leftW);
    const r = padTo(truncateToWidth(right[i] ?? "", rightW), rightW);
    lines.push(b("│") + l + b("│") + r + b("│"));
  }
  lines.push(bot);

  return lines.map((l) => truncateToWidth(l, width));
}

// ── Show / Refresh ────────────────────────────────────────────────────────────

function showDashboard(ctx: ExtensionContext, version: string, thinking: string): void {
  if (!ctx.hasUI) return;
  const model = modelLabel(ctx);
  const cwd = ctx.cwd;
  ctx.ui.setHeader((_tui, theme) => ({
    invalidate() {},
    render(width: number): string[] {
      return buildDashboard(theme, version, model, thinking, cwd, width);
    },
  }));
}

function refresh(ctx: ExtensionContext, enabled: boolean, version: string, thinking: string): void {
  if (!ctx.hasUI) return;
  if (!enabled || hasConversation(ctx)) {
    ctx.ui.setHeader(undefined);
    return;
  }
  showDashboard(ctx, version, thinking);
}

// ── Extension Entry Point ─────────────────────────────────────────────────────

export default function welcomeDashboardExtension(pi: ExtensionAPI) {
  const version = getPiVersion();
  let enabled = readEnabledConfig();

  pi.registerCommand("welcome", {
    description: "Toggle the welcome dashboard on/off",
    handler: async (args, ctx) => {
      const a = args.trim().toLowerCase();
      if (a === "on" || a === "enable") enabled = true;
      else if (a === "off" || a === "disable") enabled = false;
      else enabled = !enabled;

      writeEnabledConfig(enabled);
      if (enabled) showDashboard(ctx, version, pi.getThinkingLevel());
      else ctx.ui.setHeader(undefined);
      ctx.ui.notify(`Welcome dashboard ${enabled ? "enabled" : "disabled"}`, "info");
    },
  });

  const handle = async (_e: unknown, ctx: ExtensionContext) =>
    refresh(ctx, (enabled = readEnabledConfig()), version, pi.getThinkingLevel());

  pi.on("session_start", handle);
  pi.on("model_select", handle);
  pi.on("message_start", handle);
  pi.on("agent_end", handle);
}
