/**
 * architect — second model call for design judgement (docs/architect-concept.md, -refactor.md).
 * Mechanism copied from advisor-pi (agent/npm/node_modules/advisor-pi/src/index.ts): one
 * completeSimple() call, no tools, fixed system prompt + capped transcript, per-branch use
 * count via pi.appendEntry. `Type` comes via pi-ai's typebox re-export -- see concept §10.
 */
import { completeSimple, Type, type Message, type ThinkingLevel, type Usage } from "@earendil-works/pi-ai";
import { buildSessionContext, convertToLlm, serializeConversation, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
export const STATE_ENTRY = "architect-state";
const TOOL_NAME = "architect";
const DEFAULT_MODEL = "openai-codex/gpt-5.6-terra";
const DEFAULT_THINKING: ThinkingLevel = "high";
const DEFAULT_MAX_USES = 3;
const DEFAULT_MAX_TOKENS = 4_000;
const DEFAULT_TIMEOUT_MS = 600_000;
const DEFAULT_MAX_TRANSCRIPT_CHARS = 20_000;
const THINKING_LEVELS = ["minimal", "low", "medium", "high", "xhigh"];
const schema = Type.Object({
	question: Type.String({ description: "The change to design, in one or two sentences." }),
	context: Type.Optional(Type.String({ description: "Excerpts the executor has read: paths, line ranges, snippets, constraints." })),
	constraints: Type.Optional(Type.String({ description: "Explicit must/must-not requirements from the user." })),
});
type Config = { enabled: boolean; provider: string; modelId: string; thinking: ThinkingLevel; maxUses: number; maxTokens: number; timeoutMs: number; maxTranscriptChars: number };
type StateEntry = { version: 1; config: Config; useCount: number; updatedAt: string };
type Details = { architect: { provider: string; model: string; useCount: number; maxUses: number; elapsedMs: number; stopReason: string; usage?: Usage }; state: StateEntry };
function defaultConfig(): Config {
	const [provider, modelId] = DEFAULT_MODEL.split("/");
	return { enabled: true, provider, modelId, thinking: DEFAULT_THINKING, maxUses: DEFAULT_MAX_USES, maxTokens: DEFAULT_MAX_TOKENS, timeoutMs: DEFAULT_TIMEOUT_MS, maxTranscriptChars: DEFAULT_MAX_TRANSCRIPT_CHARS };
}

const GUIDANCE_LAST = "When no uses are left, say so and continue without it.";
const GUIDANCE_BODY = [
	'Call `architect` when:',
	'- the user asks for it ("consult/ask the architect", "get a design first", "/design"), or',
	"- before presenting a plan for, or implementing, a change that adds a component, crosses a",
	"  module boundary, changes a public interface or data model, or touches more than ~3 files --",
	"  once you have read the relevant code. This applies even when the user only asked for a plan.",
	"Do not call it for single-file fixes, renames, formatting, questions, or exploration.",
	"Say in one line that you are consulting the architect and why. After a plan returns,",
	"present it (or write PLAN.md when asked for a plan) before implementing.",
	"Architect vs advisor: architect produces the design for a change; advisor gives strategic",
	"advice when you are stuck, see risk, or need to correct course. If the architect's plan",
	'says "Escalate: yes", ask the user before calling advisor. If the user asks for both,',
	"call architect first, then advisor with the plan as context.",
].join("\n");

const SYSTEM_PROMPT = `You are the architect for a Pi coding session. You design; you do not implement.
You have no tools. Everything you know about the codebase is in the question, the
context, and the conversation transcript below.
Rules:
- Ground every constraint and affected file in evidence from the input. Cite it as
  path:line when the input gives lines. If a needed fact is missing, list it under
  Open questions instead of assuming.
- Prefer the smallest coherent change that follows existing conventions. No new
  abstractions without a stated, concrete need.
- Make trade-offs explicit. If one decision is genuinely hard or high-risk, say so
  under Escalate.
- Be concise. Do not restate the transcript.
Return exactly these sections:
## Goal            one sentence
## Constraints     bullet list, each with its evidence
## Design          components, interfaces, data flow
## Affected files  path — change
## Risks           including compatibility and security where relevant
## Sequence        ordered implementation steps
## Acceptance      testable criteria, each with how to verify
## Open questions  facts the architect needed but did not have
## Escalate        yes|no — if yes, one paragraph: the decision, the options, why`;
// Capped, most-recent-first transcript of the current conversation (mirrors advisor-pi).
function transcript(ctx: ExtensionContext, maxChars: number): string {
	const sc = buildSessionContext(ctx.sessionManager.getEntries(), ctx.sessionManager.getLeafId());
	const text = serializeConversation(convertToLlm(sc.messages));
	if (maxChars <= 0 || text.length <= maxChars) return text;
	const omitted = text.length - maxChars;
	return `[... earlier conversation truncated: showing the most recent ${maxChars} of ${text.length} characters (${omitted} omitted)]\n\n${text.slice(text.length - maxChars)}`;
}
function stateEntry(config: Config, useCount: number): StateEntry {
	return { version: 1, config: { ...config }, useCount, updatedAt: new Date().toISOString() };
}
function skipDetails(config: Config, useCount: number): Details {
	return { architect: { provider: config.provider, model: config.modelId, useCount, maxUses: config.maxUses, elapsedMs: 0, stopReason: "skipped" }, state: stateEntry(config, useCount) };
}
// ctx.ui.notify is a no-op without a UI (pi -p / non-TUI); fall back to stdout, same fix as session-stats.ts.
function notify(ctx: ExtensionContext, message: string, level: "info" | "error" = "info") {
	if (ctx.hasUI) ctx.ui.notify(message, level);
	else console.log(message);
}

export default function architectExtension(pi: ExtensionAPI) {
	let config = defaultConfig();
	let useCount = 0;
	function refresh(ctx: ExtensionContext) {
		config = defaultConfig();
		useCount = 0;
		for (const entry of ctx.sessionManager.getBranch()) {
			if (entry.type === "custom" && entry.customType === STATE_ENTRY) {
				const data = entry.data as Partial<StateEntry> | undefined;
				if (data?.config) config = { ...config, ...data.config };
				if (typeof data?.useCount === "number") useCount = Math.max(0, data.useCount);
			} else if (entry.type === "message" && entry.message.role === "toolResult" && entry.message.toolName === TOOL_NAME) {
				const details = entry.message.details as Partial<Details> | undefined;
				if (details?.state?.config) config = { ...config, ...details.state.config };
				if (typeof details?.state?.useCount === "number") useCount = Math.max(useCount, details.state.useCount);
			}
		}
		const active = pi.getActiveTools();
		const has = active.includes(TOOL_NAME);
		if (config.enabled && !has) pi.setActiveTools([...active, TOOL_NAME]);
		else if (!config.enabled && has) pi.setActiveTools(active.filter((t) => t !== TOOL_NAME));
	}
	const persist = () => pi.appendEntry(STATE_ENTRY, stateEntry(config, useCount));

	pi.registerTool<typeof schema, Details>({
		name: TOOL_NAME,
		label: "Architect",
		description:
			"Consult the architect: a separate higher-capability model that turns evidence you have gathered into a structured design plan (goal, constraints, design, affected files, risks, sequence, acceptance criteria, open questions, escalation). It has no tools and cannot read files: put every relevant path, line range and code excerpt into `context`. Call it after investigating the code, not instead of it.",
		promptSnippet: "Get a structured design plan from a second model before implementing a non-trivial change.",
		promptGuidelines: [
			"Investigate first (read files, run searches); architect has no tools and only knows what you put in context.",
			"Use architect for non-trivial changes, not trivial edits or lookups; call it at most once more if its plan lists open questions you can now answer.",
		],
		parameters: schema,
		executionMode: "sequential",
		async execute(_id, params, signal, onUpdate, ctx) {
			refresh(ctx);
			if (!config.enabled) return { content: [{ type: "text", text: `architect is disabled. Continue without a plan for: ${params.question}` }], details: skipDetails(config, useCount) };
			if (useCount >= config.maxUses) return { content: [{ type: "text", text: `Architect use limit reached (${config.maxUses}). Continue without another call for: ${params.question}` }], details: skipDetails(config, useCount) };
			const model = ctx.modelRegistry.find(config.provider, config.modelId);
			if (!model) throw new Error(`Architect model not found: ${config.provider}/${config.modelId}. Run /architect model <provider>/<id>.`);
			onUpdate?.({ content: [{ type: "text", text: `Consulting architect ${config.provider}/${config.modelId} (${config.thinking})...` }], details: skipDetails(config, useCount) });
			const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
			if (!auth.ok) throw new Error(auth.error);
			const startedAt = Date.now();
			const userText = [
				"## Question", params.question, "",
				...(params.constraints ? ["## Constraints", params.constraints, ""] : []),
				...(params.context ? ["## Context", params.context, ""] : []),
				"## Conversation Transcript", transcript(ctx, config.maxTranscriptChars),
			].join("\n");
			const userMessage: Message = { role: "user", content: [{ type: "text", text: userText }], timestamp: Date.now() };
			const response = await completeSimple(model, { systemPrompt: SYSTEM_PROMPT, messages: [userMessage] }, {
				apiKey: auth.apiKey, headers: auth.headers, signal, reasoning: config.thinking,
				maxTokens: config.maxTokens, timeoutMs: config.timeoutMs, sessionId: `architect:${ctx.sessionManager.getSessionId()}`,
			});
			if (response.stopReason === "error") throw new Error(response.errorMessage ?? "Architect model returned an error");
			if (response.stopReason === "aborted") throw new Error("Architect call aborted");
			useCount += 1;
			persist();
			const text = response.content.filter((p): p is { type: "text"; text: string } => p.type === "text").map((p) => p.text).join("\n").trim() || "Architect returned no plan text.";
			const details: Details = { architect: { provider: response.provider, model: response.model, useCount, maxUses: config.maxUses, elapsedMs: Date.now() - startedAt, stopReason: response.stopReason, usage: response.usage }, state: stateEntry(config, useCount) };
			return { content: [{ type: "text", text: `Architect plan (${useCount}/${config.maxUses}, ${config.provider}/${config.modelId}, ${config.thinking}):\n\n${text}` }], details };
		},
	});

	pi.registerCommand("architect", {
		description: "Configure architect: status, enable, disable, model <provider>/<id>, thinking <level>, max-uses <n>",
		handler: async (args, ctx) => {
			refresh(ctx);
			const [cmd, ...rest] = args.trim().split(/\s+/);
			const value = rest.join(" ").trim();
			const usage = "Usage: /architect [status|enable|disable|model <provider>/<id>|thinking <level>|max-uses <n>]";
			if (!cmd || cmd === "status") { const found = ctx.modelRegistry.find(config.provider, config.modelId); return notify(ctx, `architect ${config.enabled ? "enabled" : "disabled"} • model: ${config.provider}/${config.modelId} (${found ? "available" : "not found"}) • thinking: ${config.thinking} • uses: ${useCount}/${config.maxUses}`); }
			if (cmd === "enable" || cmd === "disable") { config.enabled = cmd === "enable"; return persist(), refresh(ctx), notify(ctx, `architect ${config.enabled ? "enabled" : "disabled"}`); }
			if (cmd === "model") {
				const slash = value.indexOf("/");
				const [provider, modelId] = [value.slice(0, slash), value.slice(slash + 1)];
				if (slash <= 0 || !ctx.modelRegistry.find(provider, modelId)) return notify(ctx, slash <= 0 ? usage : `Architect model not found: ${provider}/${modelId}`, "error");
				[config.provider, config.modelId] = [provider, modelId];
				return persist(), notify(ctx, `architect model set to ${provider}/${modelId}`);
			}
			if (cmd === "thinking") { if (!THINKING_LEVELS.includes(value)) return notify(ctx, usage, "error"); config.thinking = value as ThinkingLevel; return persist(), notify(ctx, `architect thinking set to ${value}`); }
			if (cmd === "max-uses") { const n = Number.parseInt(value, 10); if (!Number.isFinite(n) || n < 0) return notify(ctx, usage, "error"); config.maxUses = n; return persist(), notify(ctx, `architect max uses set to ${n}`); }
			return notify(ctx, usage, "error");
		},
	});

	pi.on("session_start", async (_e, ctx) => refresh(ctx));
	pi.on("session_tree", async (_e, ctx) => refresh(ctx));
	pi.on("before_agent_start", async (event, ctx) => {
		refresh(ctx);
		if (!config.enabled) return; // inject nothing when disabled
		const remaining = Math.max(0, config.maxUses - useCount);
		const first = `Architect is enabled: ${config.provider}/${config.modelId}, ${config.thinking} thinking, ${remaining}/${config.maxUses} uses left on this branch.`;
		// At the cap, drop the "call architect when..." body (R2): keep only the first line (0/<max>) and the last.
		const guidance = remaining === 0 ? `${first}\n${GUIDANCE_LAST}` : `${first}\n${GUIDANCE_BODY}\n${GUIDANCE_LAST}`;
		return { systemPrompt: `${event.systemPrompt}\n\n${guidance}` };
	});
}
