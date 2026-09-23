/**
 * Pure child-launch argument builder for the subagent runtime.
 *
 * Implements subagent_concept.md §3.2 (the "child launch contract") plus the
 * Phase 1 local deltas D1, D3, D4, D5, D8. Deliberately has NO imports from
 * `@earendil-works/pi-coding-agent` / `pi-ai` / `pi-tui` and does no I/O
 * (no fs, no spawn) so it can be unit-tested with plain `node
 * --experimental-strip-types` (see scripts/test-subagent-launch.ts) without a
 * model call or a real child process.
 *
 * D1: buildChildArgs() is the ONLY place child argv is assembled. index.ts
 * must call this instead of building args inline (that's what the vendored
 * reference extension did, and what made -ne/-e/--session-dir easy to drop
 * silently on a future refactor).
 *
 * Spec-resolution note (T1 vs. the §3.2 ASCII diagram): the diagram lists the
 * two guardrail `-e` flags before "[role extras]", but T1 in §8.1 requires
 * guardrails to appear AFTER any frontmatter `extensions:`. This module
 * follows T1 (guardrails last, immediately before --tools) because T1 is the
 * literal, checkable spec; the diagram is illustrative. Either order satisfies
 * ADR-2 (guardrails always present, unconditionally) -- order doesn't change
 * whether they're loaded, only argv layout -- so this is a documentation
 * resolution, not a behavior compromise.
 */

export const MAX_CONCURRENCY = 2;
export const MAX_PARALLEL_TASKS = 4;

/** Filenames of the two guardrail extensions, resolved under `<agentDir>/extensions/`. */
export const GUARDRAIL_EXTENSION_FILES = ["permission-gate.ts", "protected-paths.ts"] as const;

export interface LaunchAgent {
	/** Agent name, e.g. "explorer". Used in --name and error messages. */
	name: string;
	/**
	 * Required, non-empty tool allowlist (D3). An agent without this is
	 * rejected -- callers must not substitute a default tool set.
	 */
	tools: string[];
	/** Frontmatter `model`, including an optional `:thinking` suffix. */
	model?: string;
	/**
	 * Thinking level to request via a separate `--thinking` flag, used only
	 * when the agent has no `model` override of its own and inherits the
	 * parent's dispatch defaults (preserves the upstream reference behavior;
	 * not part of the §3.2 contract itself, so it's optional and additive).
	 */
	thinkingLevel?: string;
	/**
	 * Frontmatter `extensions:` (D2) -- extra `-e` paths, already resolved to
	 * absolute paths by the caller (agents.ts resolves them relative to
	 * `~/.pi/agent`, per §3.2). This module does not touch the filesystem, so
	 * it does not itself resolve or validate existence -- that's `agents.ts` /
	 * `lint-agents.py`'s job.
	 */
	extensions?: string[];
	/**
	 * Absolute path to a temp file holding the role system prompt (mode
	 * 0600), already written by the caller. Omitted only when the agent has
	 * no system prompt body.
	 */
	systemPromptPath?: string;
}

export interface BuildChildArgsContext {
	/** `~/.pi/agent` (i.e. `getAgentDir()`), passed in rather than imported so this module has no pi dependency. */
	agentDir: string;
	/** Override for `--session-dir`. Defaults to `<agentDir>/sessions/subagents`. Test-only knob. */
	sessionsDir?: string;
	/**
	 * `PI_SUBAGENT_DEPTH` inherited from the parent's environment, as a
	 * number (0 for a top-level/main-session parent that has never spawned a
	 * subagent itself). D4: refuse to spawn when this is already >= 1.
	 */
	parentDepth: number;
}

export interface BuiltChildArgs {
	args: string[];
	env: Record<string, string>;
	sessionsDir: string;
	name: string;
}

export class SubagentRecursionError extends Error {
	constructor(depth: number) {
		super(
			`Refusing to spawn a subagent: inherited PI_SUBAGENT_DEPTH=${depth} (>= 1). ` +
				"Subagents cannot spawn further subagents (-ne already prevents the tool " +
				"from loading in the child; this is the belt-and-braces check, D4).",
		);
		this.name = "SubagentRecursionError";
	}
}

export class SubagentToolsRequiredError extends Error {
	constructor(agentName: string) {
		super(
			`Agent "${agentName}" has no non-empty "tools" in its frontmatter. ` +
				"An explicit tools: list is required (D3) -- it is never defaulted.",
		);
		this.name = "SubagentToolsRequiredError";
	}
}

function truncate(text: string, maxLen: number): string {
	const collapsed = text.replace(/\s+/g, " ").trim();
	if (collapsed.length <= maxLen) return collapsed;
	return `${collapsed.slice(0, Math.max(0, maxLen - 1))}…`;
}

/** Minimal, dependency-free join, since this module must not import node:path. */
function joinPath(...parts: string[]): string {
	return parts
		.map((p, i) => (i === 0 ? p.replace(/\/+$/, "") : p.replace(/^\/+|\/+$/g, "")))
		.filter(Boolean)
		.join("/");
}

/**
 * Build the argv + env for one child `pi` process, per §3.2. Pure: same
 * inputs always produce the same output, no side effects.
 *
 * Throws SubagentRecursionError (D4) or SubagentToolsRequiredError (D3)
 * instead of returning a degraded/partial argv -- callers must not catch
 * these and fall back to a default, since that would silently defeat the
 * guarantees these errors exist to enforce.
 */
export function buildChildArgs(agent: LaunchAgent, task: string, ctx: BuildChildArgsContext): BuiltChildArgs {
	if (ctx.parentDepth >= 1) {
		throw new SubagentRecursionError(ctx.parentDepth);
	}
	if (!agent.tools || agent.tools.length === 0) {
		throw new SubagentToolsRequiredError(agent.name);
	}

	const sessionsDir = ctx.sessionsDir ?? joinPath(ctx.agentDir, "sessions", "subagents");
	const name = `${agent.name}: ${truncate(task, 60)}`;

	const args: string[] = ["--mode", "json", "-p", "-ne"];

	// Role extras first, guardrails last (T1) -- see the module doc comment.
	for (const extPath of agent.extensions ?? []) {
		args.push("-e", extPath);
	}
	for (const file of GUARDRAIL_EXTENSION_FILES) {
		args.push("-e", joinPath(ctx.agentDir, "extensions", file));
	}

	// --tools is always explicit and non-empty (D3); never omitted so pi
	// would fall back to its own default tool set.
	args.push("--tools", agent.tools.join(","));

	if (agent.model) {
		args.push("--model", agent.model);
	}
	if (agent.thinkingLevel) {
		args.push("--thinking", agent.thinkingLevel);
	}

	// ADR-5 / D1: always persisted, named, never --no-session.
	args.push("--session-dir", sessionsDir);
	args.push("--name", name);

	if (agent.systemPromptPath) {
		args.push("--append-system-prompt", agent.systemPromptPath);
	}

	// Single argv element. Because this is an array passed to spawn(..., {shell:
	// false}), quotes/newlines/leading "-" in `task` cannot split or inject
	// extra arguments (T6) -- there is no shell to reinterpret them.
	args.push(`Task: ${task}`);

	return {
		args,
		env: { PI_SUBAGENT_DEPTH: String(ctx.parentDepth + 1) },
		sessionsDir,
		name,
	};
}
