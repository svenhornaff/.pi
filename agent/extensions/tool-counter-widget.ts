/**
 * Tool Counter Widget Extension
 * 
 * Displays a widget showing the number of tool calls made in the current session.
 * Tracks total calls and breaks down by tool type.
 * 
 * Usage:
 *   Extension auto-loads from ~/.pi/agent/extensions/
 *   Use /reload to hot-reload after changes
 * 
 * Commands:
 *   /toolcount - Show detailed tool usage stats
 *   /resetcount - Reset the tool counter
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
	/**
	 * Update the widget display
	 */
	// Track tool calls
	let totalCalls = 0;
	const toolCounts: Record<string, number> = {};

	function updateWidget(ctx: ExtensionContext) {
		if (!ctx.hasUI) return;

		// Get top 3 tools
		const topTools = Object.entries(toolCounts)
			.sort((a, b) => b[1] - a[1])
			.slice(0, 3)
			.map(([name, count]) => `${name}:${count}`)
			.join(" ");

		const widgetText = topTools 
			? `🔧 Tools: ${totalCalls} (${topTools})`
			: `🔧 Tools: ${totalCalls}`;

		ctx.ui.setWidget("tool-counter", [widgetText], { placement: "aboveEditor" });
	}

	// Track successful tool executions
	pi.on("tool_result", async (event, ctx) => {
		totalCalls++;
		
		const toolName = event.toolName;
		toolCounts[toolName] = (toolCounts[toolName] || 0) + 1;
		
		updateWidget(ctx);
	});

	// Reset + initialize widget on session start (covers startup, reload, new,
	// resume, and fork via event.reason — session_switch/session_fork are not
	// real pi events, so the separate handler that used to listen for them was dead code).
	pi.on("session_start", (_event, ctx) => {
	  totalCalls = 0;
	  Object.keys(toolCounts).forEach(k => delete toolCounts[k]);
	  updateWidget(ctx);
	});

	// Command to show detailed stats
	pi.registerCommand("toolcount", {
		description: "Show detailed tool usage statistics",
		handler: async (_args, ctx) => {
			if (totalCalls === 0) {
				ctx.ui.notify("No tools called yet in this session", "info");
				return;
			}

			const sortedTools = Object.entries(toolCounts)
				.sort((a, b) => b[1] - a[1]);

			let message = `Total tool calls: ${totalCalls}\n\nBreakdown:\n`;
			for (const [name, count] of sortedTools) {
				const percentage = ((count / totalCalls) * 100).toFixed(1);
				message += `  ${name}: ${count} (${percentage}%)\n`;
			}

			ctx.ui.notify(message, "info");
		},
	});

	// Command to reset counter
	pi.registerCommand("resetcount", {
		description: "Reset the tool counter",
		handler: async (_args, ctx) => {
			const oldCount = totalCalls;
			totalCalls = 0;
			Object.keys(toolCounts).forEach(key => delete toolCounts[key]);
			
			updateWidget(ctx);
			ctx.ui.notify(`Tool counter reset (was: ${oldCount})`, "info");
		},
	});
}
