/**
 * Git Checkpoint Extension
 *
 * Creates a git stash checkpoint at the start of each LLM turn so that
 * `/fork` can offer to restore code state to that exact point.
 *
 * How it works:
 *   - On turn_start: `git stash create` captures a stash object (SHA1 ref)
 *     without pushing it to the stash list, so `git stash list` stays clean.
 *   - Refs are mapped to the current session leaf entry ID.
 *   - On session_before_fork: if a checkpoint ref exists for the forked entry,
 *     the user is offered the choice to restore code to that state.
 *   - On agent_end: in-memory checkpoint map is cleared.
 *
 * Reference: examples/extensions/git-checkpoint.ts (pi v0.57.1)
 *
 * Perf note (2026-08-29, ~.pi/setup-refactor-plan.md Phase 4 item 5): skips the
 * `git stash create` call entirely when the cwd isn't a git repo, or when the
 * working tree is already clean (nothing to check-point), instead of shelling
 * out on every single turn unconditionally.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
	const checkpoints = new Map<string, string>();
	let currentEntryId: string | undefined;

	// Track the leaf entry ID so we can associate stash refs with session entries.
	pi.on("tool_result", async (_event, ctx) => {
		const leaf = ctx.sessionManager.getLeafEntry();
		if (leaf) currentEntryId = leaf.id;
	});

	// Track whether we've already established this is (not) a git repo, so we
	// don't re-run `git rev-parse` on every single turn of a long session.
	let isGitRepo: boolean | undefined;

	// Create a stash checkpoint before each LLM turn — but only when there's
	// actually something to check-point.
	pi.on("turn_start", async () => {
		if (isGitRepo === undefined) {
			const { code } = await pi.exec("git", ["rev-parse", "--is-inside-work-tree"]);
			isGitRepo = code === 0;
		}
		if (!isGitRepo) return; // not a git repo — nothing to do, and nothing to re-check each turn

		// Skip the stash entirely when the working tree has no uncommitted changes —
		// there is nothing meaningful to restore to, so this avoids a needless
		// `git stash create` subprocess on every turn of a long, mostly-read-only session.
		const { stdout: statusOut, code: statusCode } = await pi.exec("git", ["status", "--porcelain"]);
		if (statusCode !== 0 || statusOut.trim() === "") return;

		// git stash create returns a ref without pushing to the stash list.
		const { stdout, code } = await pi.exec("git", ["stash", "create"]);
		if (code !== 0) return; // race/other error — skip silently
		const ref = stdout.trim();
		if (ref && currentEntryId) {
			checkpoints.set(currentEntryId, ref);
		}
	});

	// When forking, offer to restore code to the state at that checkpoint.
	pi.on("session_before_fork", async (event, ctx) => {
		const ref = checkpoints.get(event.entryId);
		if (!ref) return;

		if (!ctx.hasUI) {
			// Non-interactive mode: skip restore prompt, leave code as-is.
			return;
		}

		const choice = await ctx.ui.select("Restore code state?", [
			"Yes, restore code to that point",
			"No, keep current code",
		]);

		if (choice?.startsWith("Yes")) {
			const { code } = await pi.exec("git", ["stash", "apply", ref]);
			if (code === 0) {
				ctx.ui.notify("Code restored to checkpoint", "info");
			} else {
				ctx.ui.notify("Failed to restore checkpoint — apply the stash manually", "warning");
			}
		}
	});

	// Clear the in-memory map once the agent finishes responding.
	pi.on("agent_end", async () => {
		checkpoints.clear();
	});
}
