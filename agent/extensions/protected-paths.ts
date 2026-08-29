/**
 * Protected Paths Extension
 *
 * Blocks write and edit operations to sensitive paths — via the `write`/`edit`
 * tools directly, AND via `bash` commands that write files through shell
 * redirection or common file-writing utilities (this second check was added
 * 2026-08-29 after a smoke test showed the model satisfying a "write to .env"
 * request via `printf ... > .env` in bash, completely bypassing the original
 * write/edit-only gate).
 *
 * Protected paths (substring match against the target path):
 *   .env*             — environment / secrets files (.env, .env.local, ...)
 *   .git/             — git internals
 *   node_modules/     — vendored JS dependencies
 *   auth.json         — pi credential store
 *   ~/.pi/agent/models.json     — pi model/provider config (cost, compat flags)
 *   ~/.pi/agent/settings.json   — pi settings (enabledModels, contextPrune, etc.)
 *   ~/.pi/web-search.json       — web-search provider/routing config
 *   .npmrc, .pypirc   — package-registry credentials
 *   .ssh/, .gnupg/    — SSH/GPG key material
 *   id_rsa / id_ed25519 (and .pub) — SSH key files by name, wherever they live
 *   token / secret / credential(s) — generic substrings for anything that looks
 *     like a credential file, wherever it lives (e.g. api-token.txt, secrets.yaml)
 *
 * The bash check is deliberately conservative in the other direction: it only
 * fires when the command contains BOTH a protected-path-looking token AND a
 * write-indicating construct (`>`, `>>`, `tee`, `cp`, `mv`, `dd`, `sed -i`,
 * `truncate`, `install`, or a Python/Node one-liner opening a file for write).
 * A bare `cat .env` or `grep -r secret .` still passes through unblocked —
 * this gate is about preventing writes, not about hiding that these paths
 * exist. False positives here just mean an extra confirmation prompt, which
 * is the acceptable direction to err on for a security gate.
 *
 * In non-interactive mode the block is silent (no notify); the LLM
 * receives the block reason via the tool result.
 *
 * Reference: examples/extensions/protected-paths.ts (pi v0.57.1)
 * Expanded 2026-08-29 per ~/.pi/setup-refactor-plan.md Phase 4, item 4.
 * Bash bypass closed 2026-08-29 after smoke-test discovery (see script/log).
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
	const HOME = process.env.HOME || "";

	// Exact/substring path fragments — protected regardless of where they appear.
	const PROTECTED_SUBSTRINGS = [
		".env",
		".git/",
		"node_modules/",
		"auth.json",
		".npmrc",
		".pypirc",
		".ssh/",
		".gnupg/",
		"id_rsa",
		"id_ed25519",
	];

	// Absolute paths to pi's own privileged config — protected specifically, not
	// just by substring, since "settings.json"/"models.json" alone are too generic
	// to block everywhere (a project may legitimately have its own settings.json).
	const PROTECTED_ABSOLUTE = [
		`${HOME}/.pi/agent/auth.json`,
		`${HOME}/.pi/agent/models.json`,
		`${HOME}/.pi/agent/settings.json`,
		`${HOME}/.pi/web-search.json`,
	];

	// Generic credential-shaped filename patterns, wherever they occur.
	const PROTECTED_PATTERNS = [/token/i, /secret/i, /credential/i];

	function isProtectedPath(filePath: string): boolean {
		return (
			PROTECTED_SUBSTRINGS.some((p) => filePath.includes(p)) ||
			PROTECTED_ABSOLUTE.some((p) => filePath === p) ||
			PROTECTED_PATTERNS.some((p) => p.test(filePath))
		);
	}

	// Constructs that indicate the command WRITES a file, as opposed to just
	// reading/searching one. Kept intentionally broad — see file header.
	const WRITE_INDICATORS =
		/(>>?(?!\s*&)|(?<!\|\|)\btee\b|\bcp\b|\bmv\b|\bdd\b|\bsed\s+-[a-zA-Z]*i|\btruncate\b|\binstall\b(?!.*-g\b)|open\([^)]*['"]w)/i;

	pi.on("tool_call", async (event, ctx) => {
		if (event.toolName === "write" || event.toolName === "edit") {
			const filePath = event.input.path as string;
			if (!isProtectedPath(filePath)) return undefined;

			if (ctx.hasUI) {
				ctx.ui.notify(`Blocked write to protected path: ${filePath}`, "warning");
			}
			return { block: true, reason: `Path "${filePath}" is protected` };
		}

		if (event.toolName === "bash") {
			const command = event.input.command as string;
			if (!WRITE_INDICATORS.test(command)) return undefined;

			const matchedPath =
				PROTECTED_SUBSTRINGS.find((p) => command.includes(p)) ??
				PROTECTED_ABSOLUTE.find((p) => command.includes(p)) ??
				PROTECTED_PATTERNS.find((p) => p.test(command))?.source;
			if (!matchedPath) return undefined;

			if (ctx.hasUI) {
				ctx.ui.notify(`Blocked bash command writing to a protected path (matched "${matchedPath}")`, "warning");
			}
			return {
				block: true,
				reason: `Command appears to write to a protected path (matched "${matchedPath}"); use the write/edit tools if this is legitimate, or ask the user to do it manually`,
			};
		}

		return undefined;
	});
}
