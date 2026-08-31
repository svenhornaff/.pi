/**
 * Permission Gate Extension
 *
 * Prompts for confirmation before running potentially dangerous bash commands.
 *
 * Categories checked (see DANGEROUS below for the full, commented pattern list):
 *   - destructive filesystem ops: rm -rf, sudo, chmod/chown 777, git reset --hard
 *   - destructive data ops: DROP/TRUNCATE TABLE
 *   - network egress / remote execution: curl, wget, nc, ssh, scp, rsync (with a
 *     remote-looking target), piping a remote fetch into a shell
 *   - git/publish actions that are hard to undo: git push (esp. --force), gh pr merge,
 *     gh release create, npm publish
 *   - broad/global package or system side effects: npm/pip/brew/pipx global installs,
 *     docker run with a home-directory bind mount
 *   - credential/secret exfiltration risk: reading from the macOS keychain, 1Password
 *     CLI, cloud provider auth/config commands
 *
 * In non-interactive mode (pi -p / JSON), dangerous commands are blocked outright
 * because no UI is available to prompt the user.
 *
 * Reference: examples/extensions/permission-gate.ts (pi v0.57.1)
 * Expanded 2026-08-29 per ~/.pi/docs/setup-refactor-plan.md Phase 4, item 4.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
	const DANGEROUS: { pattern: RegExp; label: string }[] = [
		// --- destructive filesystem / privilege ---
		{ pattern: /\brm\s+(-rf?|--recursive)\b/i, label: "recursive/forced delete" },
		{ pattern: /\bsudo\b/i, label: "privilege escalation (sudo)" },
		{ pattern: /\b(chmod|chown)\b.*777/i, label: "world-writable permissions" },
		{ pattern: /\bgit\s+reset\s+--hard\b/i, label: "destructive git reset" },
		{ pattern: /\bgit\s+clean\s+-[a-z]*f/i, label: "destructive git clean" },

		// --- destructive data ---
		{ pattern: /\bDROP\s+TABLE\b/i, label: "DROP TABLE" },
		{ pattern: /\btruncate\s+table\b/i, label: "TRUNCATE TABLE" },

		// --- network egress / remote execution ---
		// curl/wget piped straight into a shell — classic "curl | bash" RCE pattern.
		{
			pattern: /\b(curl|wget)\b[^|;&\n]*\|\s*(sudo\s+)?(bash|sh|zsh|python3?)\b/i,
			label: "pipe remote content into a shell",
		},
		{
			pattern: /\bnc\s+(-\w+\s+)*[\w.-]+\s+\d+/i,
			label: "netcat to a remote host",
		},
		{ pattern: /\bssh\b/i, label: "remote shell (ssh)" },
		{ pattern: /\bscp\b/i, label: "remote copy (scp)" },
		{ pattern: /\brsync\b.*(:|@)/i, label: "rsync to a remote target" },

		// --- git/publish actions that are hard to undo ---
		{ pattern: /\bgit\s+push\b.*(--force|-f\b)/i, label: "force push" },
		{ pattern: /\bgit\s+push\b/i, label: "git push" },
		{ pattern: /\bgh\s+pr\s+merge\b/i, label: "merge a pull request" },
		{ pattern: /\bgh\s+release\b/i, label: "create/modify a GitHub release" },
		{ pattern: /\bnpm\s+publish\b/i, label: "publish an npm package" },

		// --- broad/global installs & side effects ---
		{ pattern: /\bnpm\s+(i|install)\s+.*-g\b/i, label: "global npm install" },
		{
			pattern: /\bpip3?\s+install\b(?!.*--user)/i,
			label: "pip install (verify venv/target)",
		},
		{
			pattern: /\bbrew\s+(install|uninstall|upgrade)\b/i,
			label: "modify Homebrew packages",
		},
		{ pattern: /\bpipx\s+install\b/i, label: "pipx global install" },
		{
			pattern: /\bdocker\s+run\b.*-v\s+(~|\$HOME|\/Users\/[^/]+)(\/|\s|:)/i,
			label: "docker run with a home-directory bind mount",
		},

		// --- credential / secret access ---
		{
			pattern: /\bsecurity\s+find-generic-password\b/i,
			label: "read a macOS keychain secret",
		},
		{ pattern: /\bop\s+(read|item\s+get)\b/i, label: "read a 1Password secret" },
		{
			pattern: /\b(gcloud\s+auth|aws\s+configure|az\s+login)\b/i,
			label: "cloud provider auth/config",
		},
	];

	pi.on("tool_call", async (event, ctx) => {
		if (event.toolName !== "bash") return undefined;

		const command = event.input.command as string;
		const match = DANGEROUS.find((d) => d.pattern.test(command));

		if (!match) return undefined;

		if (!ctx.hasUI) {
			// In non-interactive mode (pi -p, JSON), block outright — no UI to prompt.
			return {
				block: true,
				reason: `Dangerous command blocked (${match.label}, no UI for confirmation)`,
			};
		}

		const choice = await ctx.ui.select(
			`⚠️ Dangerous command (${match.label}):\n\n  ${command.slice(0, 160)}\n\nAllow?`,
			["Yes", "No"],
		);

		if (choice !== "Yes") {
			return { block: true, reason: "Blocked by user" };
		}

		return undefined;
	});
}
