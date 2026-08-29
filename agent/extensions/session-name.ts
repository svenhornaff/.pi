/**
 * Session Name Extension
 *
 * Gives sessions a human-readable name that appears in the session selector
 * instead of the first message text. Makes /resume far more navigable when
 * you have multiple sessions for the same project.
 *
 * Usage:
 *   /session-name <name>   — set a name for this session
 *   /session-name          — show the current session name
 *
 * Reference: examples/extensions/session-name.ts (pi v0.57.1)
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
	pi.registerCommand("session-name", {
		description: "Set or show session name (usage: /session-name [new name])",
		handler: async (args, ctx) => {
			const name = args.trim();

			if (name) {
				pi.setSessionName(name);
				ctx.ui.notify(`Session named: ${name}`, "info");
			} else {
				const current = pi.getSessionName();
				ctx.ui.notify(current ? `Session: ${current}` : "No session name set — use /session-name <name>", "info");
			}
		},
	});
}
