#!/usr/bin/env node
/**
 * Deterministic tests for agent/extensions/subagent/launch.ts (T1-T6, §8.1).
 *
 * No model calls, no spawned pi process, no filesystem writes -- these test
 * buildChildArgs() directly. Run with:
 *
 *   node --experimental-strip-types scripts/test-subagent-launch.ts
 *
 * Exit code 0 = all passed, 1 = at least one failure (failures printed).
 */

import {
	buildChildArgs,
	GUARDRAIL_EXTENSION_FILES,
	SubagentRecursionError,
	SubagentToolsRequiredError,
	type LaunchAgent,
} from "../agent/extensions/subagent/launch.ts";

const AGENT_DIR = "/Users/brooklyn/.pi/agent";

let failures = 0;
let passed = 0;

function check(name: string, cond: boolean, detail?: string) {
	if (cond) {
		passed++;
		console.log(`ok   ${name}`);
	} else {
		failures++;
		console.error(`FAIL ${name}${detail ? ` -- ${detail}` : ""}`);
	}
}

function baseAgent(overrides: Partial<LaunchAgent> = {}): LaunchAgent {
	return { name: "explorer", tools: ["read", "grep", "find", "ls"], model: "openrouter/z-ai/glm-5.3:low", ...overrides };
}

// --- T1: guardrails present, after any frontmatter `extensions:` ---
{
	const extra = "/Users/brooklyn/.pi/agent/subagent-child/git-diff-tool.ts";
	const result = buildChildArgs(baseAgent({ extensions: [extra] }), "explore the repo", {
		agentDir: AGENT_DIR,
		parentDepth: 0,
	});
	const idxExtra = result.args.indexOf(extra);
	const guardIdxs = GUARDRAIL_EXTENSION_FILES.map((f) => result.args.indexOf(`${AGENT_DIR}/extensions/${f}`));
	check("T1a: extra -e present", idxExtra > -1, JSON.stringify(result.args));
	check(
		"T1b: both guardrail -e present",
		guardIdxs.every((i) => i > -1),
		JSON.stringify(result.args),
	);
	check(
		"T1c: guardrails appear after the extra extension",
		guardIdxs.every((i) => i > idxExtra),
		JSON.stringify(result.args),
	);
}

// --- T2: never --no-session; --session-dir + --name present ---
{
	const result = buildChildArgs(baseAgent(), "explore the repo", { agentDir: AGENT_DIR, parentDepth: 0 });
	check("T2a: no --no-session anywhere in argv", !result.args.includes("--no-session"));
	check(
		"T2b: --session-dir <agentDir>/sessions/subagents present",
		result.args.includes("--session-dir") && result.args.includes(`${AGENT_DIR}/sessions/subagents`),
		JSON.stringify(result.args),
	);
	check("T2c: --name present", result.args.includes("--name"));
	check("T2d: sessionsDir field matches", result.sessionsDir === `${AGENT_DIR}/sessions/subagents`);
}

// --- T3: --tools present and equal to frontmatter; missing tools throws ---
{
	const result = buildChildArgs(baseAgent({ tools: ["read", "bash"] }), "task", { agentDir: AGENT_DIR, parentDepth: 0 });
	const toolsIdx = result.args.indexOf("--tools");
	check("T3a: --tools present", toolsIdx > -1);
	check("T3b: --tools value equals frontmatter list", result.args[toolsIdx + 1] === "read,bash");

	let threw = false;
	let threwRightType = false;
	try {
		buildChildArgs(baseAgent({ tools: [] }), "task", { agentDir: AGENT_DIR, parentDepth: 0 });
	} catch (e) {
		threw = true;
		threwRightType = e instanceof SubagentToolsRequiredError;
	}
	check("T3c: empty tools[] throws", threw);
	check("T3d: empty tools[] throws SubagentToolsRequiredError", threwRightType);

	let threwUndefined = false;
	try {
		// @ts-expect-error -- deliberately omitting the required field to prove the runtime check, not just the type
		buildChildArgs(baseAgent({ tools: undefined }), "task", { agentDir: AGENT_DIR, parentDepth: 0 });
	} catch {
		threwUndefined = true;
	}
	check("T3e: undefined tools throws", threwUndefined);
}

// --- T4: frontmatter cannot suppress guardrails ---
{
	// extensions: [] (the closest real-world equivalent of "try to suppress extras")
	const result = buildChildArgs(baseAgent({ extensions: [] }), "task", { agentDir: AGENT_DIR, parentDepth: 0 });
	const guardIdxs = GUARDRAIL_EXTENSION_FILES.map((f) => result.args.indexOf(`${AGENT_DIR}/extensions/${f}`));
	check(
		"T4a: extensions: [] still yields both guardrail -e flags",
		guardIdxs.every((i) => i > -1),
	);

	// A hypothetical extra field the type doesn't even define -- buildChildArgs
	// must ignore unknown input rather than key any behavior off it.
	const withBogusField = { ...baseAgent(), noGuards: true } as LaunchAgent & { noGuards: boolean };
	const result2 = buildChildArgs(withBogusField, "task", { agentDir: AGENT_DIR, parentDepth: 0 });
	const guardIdxs2 = GUARDRAIL_EXTENSION_FILES.map((f) => result2.args.indexOf(`${AGENT_DIR}/extensions/${f}`));
	check(
		"T4b: an unrecognized 'noGuards: true' field has no effect -- both guardrail -e flags still present",
		guardIdxs2.every((i) => i > -1),
	);
}

// --- T5: PI_SUBAGENT_DEPTH set to parent+1; refused when inherited depth >= 1 ---
{
	const result = buildChildArgs(baseAgent(), "task", { agentDir: AGENT_DIR, parentDepth: 0 });
	check("T5a: depth 0 -> env PI_SUBAGENT_DEPTH=1", result.env.PI_SUBAGENT_DEPTH === "1");

	let threw = false;
	let threwRightType = false;
	try {
		buildChildArgs(baseAgent(), "task", { agentDir: AGENT_DIR, parentDepth: 1 });
	} catch (e) {
		threw = true;
		threwRightType = e instanceof SubagentRecursionError;
	}
	check("T5b: inherited depth 1 refuses to spawn", threw);
	check("T5c: refusal throws SubagentRecursionError", threwRightType);

	let threwAtHigherDepth = false;
	try {
		buildChildArgs(baseAgent(), "task", { agentDir: AGENT_DIR, parentDepth: 3 });
	} catch {
		threwAtHigherDepth = true;
	}
	check("T5d: inherited depth > 1 also refuses", threwAtHigherDepth);
}

// --- T6: task text with quotes, newlines, leading "-" is one argv element ---
{
	const dangerousTask = `-rf /; echo "pwned"\nsecond line\`backtick\` $(whoami)`;
	const result = buildChildArgs(baseAgent(), dangerousTask, { agentDir: AGENT_DIR, parentDepth: 0 });
	const last = result.args[result.args.length - 1];
	check("T6a: last argv element is exactly 'Task: <task>' verbatim", last === `Task: ${dangerousTask}`, last);

	// The real injection-safety invariant: argv LENGTH must not depend on task
	// content (that's what "no shell to reinterpret it" means -- a shell-based
	// builder could turn embedded `;`, backticks or `$(...)` into extra tokens;
	// spawn()'s array form cannot). --name's value legitimately also contains a
	// truncated copy of the task text (by design, for observability), so
	// counting substring occurrences of "pwned" is not the right check --
	// compare against a same-shape "safe" task instead.
	const safeResult = buildChildArgs(baseAgent(), "a safe benign task of similar length to compare argv shape", {
		agentDir: AGENT_DIR,
		parentDepth: 0,
	});
	check(
		"T6b: dangerous task produces the same argv LENGTH as a benign task (no extra elements injected)",
		result.args.length === safeResult.args.length,
		`dangerous=${result.args.length} safe=${safeResult.args.length}`,
	);
	check(
		"T6c: the dangerous text appears in at most the two argv elements designed to carry it (--name value, final Task element), never split into a bare extra flag/token",
		result.args.every((a, i) => a === last || a.includes("pwned") === false || i === result.args.indexOf("--name") + 1),
	);
}

// --- name truncation sanity (supports T2/§3.2 "<task, 60 chars>") ---
{
	const longTask = "x".repeat(200);
	const result = buildChildArgs(baseAgent(), longTask, { agentDir: AGENT_DIR, parentDepth: 0 });
	check("name is truncated to a bounded length", result.name.length <= 70, `len=${result.name.length}`);
}

console.log(`\n${passed} passed, ${failures} failed`);
process.exit(failures > 0 ? 1 : 0);
