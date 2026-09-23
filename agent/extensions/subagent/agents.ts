/**
 * Agent discovery and configuration
 *
 * Vendored from pi v0.87.1's examples/extensions/subagent/agents.ts, with the
 * Phase 1 local deltas (subagent_concept.md §7 Phase 1, D2/D3/D8) applied
 * directly in place. See ../subagent/UPSTREAM.md for the full delta list.
 *
 * D2: two new frontmatter keys, `extensions:` and `timeoutMs`.
 *   - `extensions:` is a list of extra `-e` paths for the child, resolved
 *     relative to `~/.pi/agent` (i.e. getAgentDir()) per §3.2. These are
 *     ADDITIONAL to -- never a replacement for -- the two guardrail
 *     extensions, which launch.ts appends unconditionally regardless of what
 *     this field contains (ADR-2).
 *   - `timeoutMs` is read here and passed through on AgentConfig; index.ts is
 *     responsible for actually enforcing it against the spawned child.
 * D3: `tools` is REQUIRED. An agent file with no non-empty `tools:` list is
 *     rejected (skipped during discovery, with a warning) rather than
 *     silently defaulting to some tool set. This is enforced twice: here
 *     (so a broken agent file never even appears in the discovered list) and
 *     again, defensively, inside launch.ts's buildChildArgs (T3).
 * D8: `agentScope` default stays "user" -- unchanged from upstream, callers
 *     (index.ts) must not change the default there either.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { CONFIG_DIR_NAME, getAgentDir, parseFrontmatter } from "@earendil-works/pi-coding-agent";

export type AgentScope = "user" | "project" | "both";

export interface AgentConfig {
	name: string;
	description: string;
	/** D3: always present and non-empty for any AgentConfig that made it out of discovery. */
	tools: string[];
	model?: string;
	/** D2: extra `-e` paths, already resolved to absolute paths. */
	extensions?: string[];
	/** D2: kill the child after this many ms and report a timeout instead of hanging forever. */
	timeoutMs?: number;
	systemPrompt: string;
	source: "user" | "project";
	filePath: string;
}

export interface AgentDiscoveryResult {
	agents: AgentConfig[];
	projectAgentsDir: string | null;
	/** D3: agent files found but rejected for missing/empty `tools:`, for diagnostics. */
	rejected: { filePath: string; reason: string }[];
}

/**
 * Raw agent frontmatter. Values are `unknown` because `parseFrontmatter` runs a
 * real YAML parser, so any scalar or collection can appear here.
 *
 * A type alias rather than an interface: `parseFrontmatter` constrains its
 * parameter to `Record<string, unknown>`, and only an alias picks up the
 * implicit index signature that satisfies it.
 */
type AgentFrontmatter = {
	name?: unknown;
	description?: unknown;
	tools?: unknown;
	model?: unknown;
	extensions?: unknown;
	timeoutMs?: unknown;
};

/**
 * Normalize a frontmatter `tools` value to a list of tool names.
 *
 * Both spellings are valid YAML and both are in use:
 *
 *     tools: read, bash        # string
 *     tools: [read, bash]      # array
 *
 * so accept either. Anything else (a number, a map, a nested list) yields no
 * tools rather than throwing: this runs inside agent discovery, where a single
 * bad file must not take down every other agent in the same directory.
 */
function parseToolList(value: unknown): string[] | undefined {
	const raw = Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : [];
	const tools = raw
		.filter((t): t is string => typeof t === "string")
		.map((t) => t.trim())
		.filter(Boolean);
	return tools.length > 0 ? tools : undefined;
}

/**
 * D2: normalize a frontmatter `extensions` value to a list of paths, then
 * resolve each relative to `agentDir` (never relative to the agent file's own
 * directory or cwd -- §3.2 is explicit that resolution is relative to
 * `~/.pi/agent`). Absolute paths pass through unchanged.
 */
function parseExtensionsList(value: unknown, agentDir: string): string[] | undefined {
	const raw = Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : [];
	const list = raw
		.filter((t): t is string => typeof t === "string")
		.map((t) => t.trim())
		.filter(Boolean)
		.map((p) => (path.isAbsolute(p) ? p : path.join(agentDir, p)));
	return list.length > 0 ? list : undefined;
}

function parseTimeoutMs(value: unknown): number | undefined {
	if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
	return undefined;
}

function loadAgentsFromDir(
	dir: string,
	source: "user" | "project",
	agentDir: string,
	rejected: { filePath: string; reason: string }[],
): AgentConfig[] {
	const agents: AgentConfig[] = [];

	if (!fs.existsSync(dir)) {
		return agents;
	}

	let entries: fs.Dirent[];
	try {
		entries = fs.readdirSync(dir, { withFileTypes: true });
	} catch {
		return agents;
	}

	for (const entry of entries) {
		if (!entry.name.endsWith(".md")) continue;
		if (!entry.isFile() && !entry.isSymbolicLink()) continue;

		const filePath = path.join(dir, entry.name);
		let content: string;
		try {
			content = fs.readFileSync(filePath, "utf-8");
		} catch {
			continue;
		}

		const { frontmatter, body } = parseFrontmatter<AgentFrontmatter>(content);

		if (typeof frontmatter.name !== "string" || typeof frontmatter.description !== "string") {
			continue;
		}

		const tools = parseToolList(frontmatter.tools);
		if (!tools) {
			// D3: reject, don't default. Keep the file out of the discovered
			// agent list entirely rather than silently giving it some
			// fallback tool set.
			rejected.push({
				filePath,
				reason: 'missing or empty "tools:" frontmatter (D3 requires an explicit non-empty list)',
			});
			continue;
		}

		agents.push({
			name: frontmatter.name,
			description: frontmatter.description,
			tools,
			model: typeof frontmatter.model === "string" ? frontmatter.model : undefined,
			extensions: parseExtensionsList(frontmatter.extensions, agentDir),
			timeoutMs: parseTimeoutMs(frontmatter.timeoutMs),
			systemPrompt: body,
			source,
			filePath,
		});
	}

	return agents;
}

function isDirectory(p: string): boolean {
	try {
		return fs.statSync(p).isDirectory();
	} catch {
		return false;
	}
}

function findNearestProjectAgentsDir(cwd: string): string | null {
	let currentDir = cwd;
	while (true) {
		const candidate = path.join(currentDir, CONFIG_DIR_NAME, "agents");
		if (isDirectory(candidate)) return candidate;

		const parentDir = path.dirname(currentDir);
		if (parentDir === currentDir) return null;
		currentDir = parentDir;
	}
}

export function discoverAgents(cwd: string, scope: AgentScope): AgentDiscoveryResult {
	const agentDir = getAgentDir();
	const userDir = path.join(agentDir, "agents");
	const projectAgentsDir = findNearestProjectAgentsDir(cwd);
	const rejected: { filePath: string; reason: string }[] = [];

	// D8: default scope stays "user"; project agents remain opt-in via the
	// tool's own `agentScope` param default, unchanged from upstream.
	const userAgents = scope === "project" ? [] : loadAgentsFromDir(userDir, "user", agentDir, rejected);
	const projectAgents =
		scope === "user" || !projectAgentsDir ? [] : loadAgentsFromDir(projectAgentsDir, "project", agentDir, rejected);

	const agentMap = new Map<string, AgentConfig>();

	if (scope === "both") {
		for (const agent of userAgents) agentMap.set(agent.name, agent);
		for (const agent of projectAgents) agentMap.set(agent.name, agent);
	} else if (scope === "user") {
		for (const agent of userAgents) agentMap.set(agent.name, agent);
	} else {
		for (const agent of projectAgents) agentMap.set(agent.name, agent);
	}

	return { agents: Array.from(agentMap.values()), projectAgentsDir, rejected };
}

export function formatAgentList(agents: AgentConfig[], maxItems: number): { text: string; remaining: number } {
	if (agents.length === 0) return { text: "none", remaining: 0 };
	const listed = agents.slice(0, maxItems);
	const remaining = agents.length - listed.length;
	return {
		text: listed.map((a) => `${a.name} (${a.source}): ${a.description}`).join("; "),
		remaining,
	};
}
