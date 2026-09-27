/**
 * Session Stats Extension
 *
 * Adds `/session-stats`, showing cumulative token usage and cost for the
 * CURRENT session (not a single turn, not the whole ~/.pi/agent/sessions
 * corpus -- for that, see ~/.pi/scripts/session-usage-report.py).
 *
 * Reports, broken out by provider/model used in this session:
 *   - Fresh input tokens   (usage.input -- genuinely new, non-cached context)
 *   - Cache read tokens    (usage.cacheRead -- served from provider prompt cache)
 *   - Cache write tokens   (usage.cacheWrite -- cost of populating the cache)
 *   - Output tokens        (usage.output)
 *   - Reasoning tokens     (usage.reasoning, folded into output for display)
 *   - Cost per component, using usage.cost.* as recorded by pi at call time
 *     (i.e. whatever pricing was configured in models.json/models-store.json
 *     when each call happened -- this does NOT retroactively reprice history)
 *   - The active model's CURRENT configured per-million pricing, for
 *     reference/comparison against the effective rate actually paid
 *
 * Why this exists: this exact manual calculation (fresh vs. cached input,
 * per-model cost breakdown) came up repeatedly in ad-hoc form throughout
 * ~/.pi/setup-refactor-plan.md's cost investigations (see prompt-cache-
 * analysis.md and the P0 prompt-caching finding). This extension makes it
 * a standing one-command check instead of a bespoke script each time.
 *
 * Usage:
 *   /session-stats
 *
 * Source data: iterates ctx.sessionManager.getEntries() and sums usage from:
 *   - message entries with message.role === "assistant"
 *   - message entries with message.role === "toolResult" (usage is nested
 *     LLM work performed BY a tool call, e.g. pi-condense's own summarizer
 *     calls -- distinct from the assistant's own usage, and easy to miss)
 *   - compaction entries (usage from generating the compaction summary)
 *   - branch_summary entries (usage from generating a branch summary)
 * This matches the full session-cost accounting described in
 * docs/session-format.md, not just the visible assistant turns.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

interface UsageLike {
	input?: number;
	output?: number;
	cacheRead?: number;
	cacheWrite?: number;
	reasoning?: number;
	totalTokens?: number;
	cost?: {
		input?: number;
		output?: number;
		cacheRead?: number;
		cacheWrite?: number;
		total?: number;
	};
}

interface ModelTotals {
	provider: string;
	model: string;
	turns: number;
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	reasoning: number;
	costInput: number;
	costOutput: number;
	costCacheRead: number;
	costCacheWrite: number;
	costTotal: number;
}

function newTotals(provider: string, model: string): ModelTotals {
	return {
		provider,
		model,
		turns: 0,
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		reasoning: 0,
		costInput: 0,
		costOutput: 0,
		costCacheRead: 0,
		costCacheWrite: 0,
		costTotal: 0,
	};
}

function addUsage(t: ModelTotals, usage: UsageLike) {
	t.turns += 1;
	t.input += usage.input ?? 0;
	t.output += usage.output ?? 0;
	t.cacheRead += usage.cacheRead ?? 0;
	t.cacheWrite += usage.cacheWrite ?? 0;
	t.reasoning += usage.reasoning ?? 0;
	const cost = usage.cost;
	if (cost) {
		t.costInput += cost.input ?? 0;
		t.costOutput += cost.output ?? 0;
		t.costCacheRead += cost.cacheRead ?? 0;
		t.costCacheWrite += cost.cacheWrite ?? 0;
		t.costTotal += cost.total ?? (cost.input ?? 0) + (cost.output ?? 0) + (cost.cacheRead ?? 0) + (cost.cacheWrite ?? 0);
	}
}

function fmtInt(n: number): string {
	return Math.round(n).toLocaleString("en-US");
}

function fmtCost(n: number): string {
	return n.toFixed(4);
}

function computeSessionStats(ctx: ExtensionContext): { byModel: ModelTotals[]; grand: ModelTotals } {
	const byModel = new Map<string, ModelTotals>();
	const grand = newTotals("", "TOTAL");

	const entries = ctx.sessionManager.getEntries();
	for (const entry of entries as any[]) {
		let usage: UsageLike | undefined;
		let provider = "unknown";
		let model = "unknown";

		if (entry.type === "message") {
			const msg = entry.message;
			if (msg.role === "assistant" && msg.usage) {
				usage = msg.usage;
				provider = msg.provider ?? "unknown";
				model = msg.model ?? "unknown";
			} else if (msg.role === "toolResult" && msg.usage) {
				// Nested LLM work performed by a tool (e.g. pi-condense's own
				// summarizer calls). Not attributable to a provider/model field
				// on the entry itself, so bucketed separately.
				usage = msg.usage;
				provider = "(tool-internal)";
				model = msg.toolName ?? "unknown";
			}
		} else if (entry.type === "compaction" && entry.usage) {
			usage = entry.usage;
			provider = "(compaction)";
			model = "summary";
		} else if (entry.type === "branch_summary" && entry.usage) {
			usage = entry.usage;
			provider = "(branch-summary)";
			model = "summary";
		}

		if (!usage) continue;

		const key = `${provider}/${model}`;
		let totals = byModel.get(key);
		if (!totals) {
			totals = newTotals(provider, model);
			byModel.set(key, totals);
		}
		addUsage(totals, usage);
		addUsage(grand, usage);
	}

	return { byModel: Array.from(byModel.values()).sort((a, b) => b.costTotal - a.costTotal), grand };
}

function formatReport(ctx: ExtensionContext): string {
	const { byModel, grand } = computeSessionStats(ctx);

	const lines: string[] = [];
	lines.push("=== Session Stats ===");
	lines.push("");

	if (byModel.length === 0) {
		lines.push("No usage recorded yet in this session.");
		return lines.join("\n");
	}

	lines.push(
		`${"provider/model".padEnd(38)} ${"turns".padStart(6)} ${"fresh-in".padStart(11)} ${"cacheRead".padStart(11)} ${"cacheWrite".padStart(11)} ${"output".padStart(10)} ${"cost".padStart(10)}`,
	);
	lines.push("-".repeat(38 + 1 + 6 + 1 + 11 + 1 + 11 + 1 + 11 + 1 + 10 + 1 + 10));

	for (const t of byModel) {
		const label = `${t.provider}/${t.model}`;
		lines.push(
			`${label.padEnd(38)} ${String(t.turns).padStart(6)} ${fmtInt(t.input).padStart(11)} ${fmtInt(t.cacheRead).padStart(11)} ${fmtInt(t.cacheWrite).padStart(11)} ${fmtInt(t.output).padStart(10)} ${fmtCost(t.costTotal).padStart(10)}`,
		);
	}
	lines.push("-".repeat(38 + 1 + 6 + 1 + 11 + 1 + 11 + 1 + 11 + 1 + 10 + 1 + 10));
	lines.push(
		`${"TOTAL".padEnd(38)} ${String(grand.turns).padStart(6)} ${fmtInt(grand.input).padStart(11)} ${fmtInt(grand.cacheRead).padStart(11)} ${fmtInt(grand.cacheWrite).padStart(11)} ${fmtInt(grand.output).padStart(10)} ${fmtCost(grand.costTotal).padStart(10)}`,
	);

	lines.push("");
	lines.push("Cost breakdown by component (summed across all models):");
	const totalCostInput = byModel.reduce((s, t) => s + t.costInput, 0);
	const totalCostOutput = byModel.reduce((s, t) => s + t.costOutput, 0);
	const totalCostCacheRead = byModel.reduce((s, t) => s + t.costCacheRead, 0);
	const totalCostCacheWrite = byModel.reduce((s, t) => s + t.costCacheWrite, 0);
	lines.push(`  input:      ${fmtCost(totalCostInput)}`);
	lines.push(`  output:     ${fmtCost(totalCostOutput)}`);
	lines.push(`  cacheRead:  ${fmtCost(totalCostCacheRead)}`);
	lines.push(`  cacheWrite: ${fmtCost(totalCostCacheWrite)}`);
	lines.push(`  TOTAL:      ${fmtCost(grand.costTotal)}`);

	// Zero-cache flag -- same heuristic as ~/.pi/scripts/session-usage-report.py.
	const flagged = byModel.filter((t) => t.input + t.cacheRead >= 50_000 && t.cacheRead === 0 && t.provider !== "(tool-internal)" && t.provider !== "(compaction)" && t.provider !== "(branch-summary)");
	if (flagged.length > 0) {
		lines.push("");
		lines.push("⚠️  Zero cacheRead despite significant input tokens -- check compat.cacheControlFormat for:");
		for (const t of flagged) {
			lines.push(`  - ${t.provider}/${t.model} (input+cacheRead=${fmtInt(t.input + t.cacheRead)})`);
		}
	}

	// Current model's configured pricing, for reference.
	const activeModel: any = ctx.model;
	if (activeModel) {
		lines.push("");
		lines.push(`Active model pricing (${activeModel.id ?? activeModel.name ?? "unknown"}), per million tokens:`);
		const cost = activeModel.cost ?? {};
		lines.push(
			`  input=${cost.input ?? 0}  output=${cost.output ?? 0}  cacheRead=${cost.cacheRead ?? 0}  cacheWrite=${cost.cacheWrite ?? 0}`,
		);
		if (Array.isArray(cost.tiers) && cost.tiers.length > 0) {
			lines.push(`  (has ${cost.tiers.length} volume-based pricing tier(s) -- see models.json for thresholds)`);
		}
	}

	return lines.join("\n");
}

export default function (pi: ExtensionAPI) {
	pi.registerCommand("session-stats", {
		description: "Show cumulative token usage and cost for this session (fresh vs. cached input, output, per-model breakdown)",
		handler: async (_args, ctx) => {
			const report = formatReport(ctx);
			if (ctx.hasUI) {
				ctx.ui.notify(report, "info");
			} else {
				// print / json mode: ctx.ui.notify is a no-op, so fall back to
				// plain stdout so `pi -p` and scripted use still see the output.
				console.log(report);
			}
		},
	});
}
