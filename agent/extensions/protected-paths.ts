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
 * The bash check is deliberately scoped to WRITE TARGETS, not the whole command
 * string. This is the second version of this check — the first version (added
 * 2026-08-29) matched a protected-path token anywhere in the raw command text
 * once *any* write-shaped construct appeared anywhere in the command. That was
 * cheap but too blunt: it blocked plain reads like `grep -n node_modules ...`,
 * `find . -iname '*.npmrc'`, and `npm install-scripts ls` (the word "install"
 * alone tripped it), and it blocked prose that merely *mentioned* "secret" or
 * ".env" in an unrelated heredoc, all discovered as real false positives while
 * building and documenting other extensions in this same session. It also had
 * a real false negative: `2>&1` / `2>/dev/null` (a bare `>`) triggered the same
 * "write" bucket as an actual redirect-to-file.
 *
 * This version extracts the actual write TARGET(S) from each recognized
 * construct (redirect, `tee`, `dd of=`, `sed -i`, `cp`/`mv`/`install`(1)/
 * `truncate`, and Python/Node `open(path, "w")` one-liners) and only checks
 * those targets against the protected-path rules — not the whole command
 * line. `npm`/`pip`/`brew`/... `install` (the *package manager* subcommand)
 * is explicitly excluded from the cp/mv/install(1) file-target scan so it
 * doesn't get misread as the coreutils `install(1)` file-copy command.
 * `~` in a target is expanded to `$HOME` before matching, so absolute-path
 * rules (models.json/settings.json/web-search.json) still fire for the
 * tilde form most commands actually use.
 *
 * A bare `cat .env` or `grep -r secret .` still passes through unblocked —
 * this gate is about preventing writes, not about hiding that these paths
 * exist. Reading FROM a protected file to write somewhere unprotected
 * (e.g. `cp secrets.yaml /tmp/out.txt`) also passes — only the destination
 * is checked, by design; exfiltration-style reads are a different threat
 * (see permission-gate.ts's network-egress patterns) than this file's scope.
 *
 * This is deliberately a regex/substring heuristic, not a sandbox — it does
 * not try to defeat deliberate obfuscation (base64-encoded commands, unusual
 * quoting, env-var-assembled paths, etc.). It exists to catch the common,
 * non-adversarial case of an accidental or naive write to a sensitive path.
 *
 * In non-interactive mode the block is silent (no notify); the LLM
 * receives the block reason via the tool result.
 *
 * Reference: examples/extensions/protected-paths.ts (pi v0.57.1)
 * Expanded 2026-08-29 per ~/.pi/setup-refactor-plan.md Phase 4, item 4.
 * Bash bypass closed 2026-08-29 after smoke-test discovery (see script/log).
 * Bash false-positive/false-negative fix 2026-08-29 (this version) — targeted
 * write-target extraction replacing whole-command substring scanning; see
 * setup-refactor-plan.md implementation log for the specific cases that
 * motivated this and the test matrix used to verify it.
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

	function stripQuotes(s: string): string {
		return s.replace(/^['"]|['"]$/g, "");
	}

	function expandHome(p: string): string {
		return p.startsWith("~/") ? HOME + p.slice(1) : p;
	}

	function isProtectedPath(filePath: string): boolean {
		const p = expandHome(filePath);
		return (
			PROTECTED_SUBSTRINGS.some((s) => p.includes(s)) ||
			PROTECTED_ABSOLUTE.some((a) => p === a) ||
			PROTECTED_PATTERNS.some((r) => r.test(p))
		);
	}

	function isProtectedTarget(token: string): boolean {
		const t = expandHome(stripQuotes(token));
		return (
			PROTECTED_SUBSTRINGS.some((s) => t.includes(s)) ||
			PROTECTED_ABSOLUTE.some((a) => t === a || t.endsWith(a)) ||
			PROTECTED_PATTERNS.some((r) => r.test(t))
		);
	}

	// A "package manager install" subcommand (npm install, pip install, ...) is
	// not a file-target write in the sense this gate cares about — excluded so
	// the cp/mv/install(1)/truncate scan below doesn't misfire on the bare word
	// "install" (this is *separate* from install(1), the coreutils file-copy tool).
	const PACKAGE_MANAGER_INSTALL =
		/\b(?:npm|npx|pnpm|yarn|pip3?|brew|apt(?:-get)?|gem|cargo|go)\s+(?:[a-z-]+\s+)*install\b/i;

	/** Extract candidate write-target paths/tokens from a bash command string. */
	function extractWriteTargets(command: string): string[] {
		const targets: string[] = [];

		// Redirects: [n]>target / [n]>>target — but not >&N (fd dup, e.g. 2>&1)
		// and not a bare redirect straight to /dev/null.
		const redirRe = /\d{0,2}(>>?)\s*(?!&\d|\/dev\/null)([^\s;|&<>]+)/g;
		let m: RegExpExecArray | null;
		while ((m = redirRe.exec(command))) targets.push(m[2]);

		// tee [-a] target
		const teeRe = /\btee\b\s+(?:-a\s+)?([^\s;|&]+)/g;
		while ((m = teeRe.exec(command))) targets.push(m[1]);

		// dd of=target
		const ddRe = /\bof=([^\s;|&]+)/g;
		while ((m = ddRe.exec(command))) targets.push(m[1]);

		// sed -i[.bak] '<script>' <file>  (GNU/BSD forms both end with the file token)
		const sedRe =
			/\bsed\s+-[a-zA-Z]*i[a-zA-Z]*(?:\s+(?:'[^']*'|"[^"]*"))?\s+(?:'[^']*'|"[^"]*"|\S+)\s+([^\s;|&]+)/g;
		while ((m = sedRe.exec(command))) targets.push(m[1]);

		// cp/mv/install(1)/truncate: the last non-flag token in that command's
		// segment is the destination for cp/mv/install, or the target for truncate.
		const segments = command.split(/(?:&&|\|\||;|\n|\|)/);
		for (const seg of segments) {
			const trimmed = seg.trim();
			if (!trimmed) continue;
			if (PACKAGE_MANAGER_INSTALL.test(trimmed)) continue;
			if (/^(?:sudo\s+)?(?:cp|mv|install|truncate)\b/.test(trimmed)) {
				const tokens = trimmed.split(/\s+/).filter((t) => !t.startsWith("-"));
				const last = tokens[tokens.length - 1];
				if (last && !/^(?:cp|mv|install|truncate|sudo)$/.test(last))
					targets.push(last);
			}
		}

		// Python/Node one-liners: open("path", "w") / open('path', 'wb') etc.
		const openRe = /open\(\s*['"]([^'"]+)['"]\s*,\s*['"]w/g;
		while ((m = openRe.exec(command))) targets.push(m[1]);

		return targets;
	}

	/** Returns the first protected write target found in a bash command, or null. */
	function findProtectedWriteTarget(command: string): string | null {
		for (const raw of extractWriteTargets(command)) {
			const t = expandHome(stripQuotes(raw));
			if (isProtectedTarget(t)) return t;
		}
		return null;
	}

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
			const matchedTarget = findProtectedWriteTarget(command);
			if (!matchedTarget) return undefined;

			if (ctx.hasUI) {
				ctx.ui.notify(
					`Blocked bash command writing to a protected path (target: "${matchedTarget}")`,
					"warning",
				);
			}
			return {
				block: true,
				reason: `Command appears to write to a protected path ("${matchedTarget}"); use the write/edit tools if this is legitimate, or ask the user to do it manually`,
			};
		}

		return undefined;
	});
}
