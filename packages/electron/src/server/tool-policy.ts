import type { AgentMode } from "@agent-manager/shared";

/**
 * Tools that are forbidden in Plan/Ask modes.
 * These tools allow write operations or potentially destructive actions.
 */
export const PLAN_MODE_FORBIDDEN_TOOLS = [
	"write_file",
	"replace_file_content",
	"pre_file_edit",
	"post_file_edit",
	"git_add",
	"git_commit",
	"git_checkout",
	"worktree_create",
	"worktree_remove",
	"worktree_complete",
	"worktree_run",
	"run_command",
] as const;

export type ForbiddenTool = (typeof PLAN_MODE_FORBIDDEN_TOOLS)[number];

/**
 * Check if a tool is allowed for the given agent mode.
 * @param toolName - The name of the tool to check
 * @param mode - The current agent mode
 * @returns true if the tool is allowed, false otherwise
 */
export function isToolAllowedForMode(
	toolName: string,
	mode: AgentMode | undefined,
): boolean {
	// Regular mode has no restrictions
	if (!mode || mode === "regular") {
		return true;
	}

	// Plan/Ask mode: forbid write operations
	return !PLAN_MODE_FORBIDDEN_TOOLS.some((pattern) =>
		toolName.startsWith(pattern),
	);
}

/**
 * Filter tools by agent mode, removing forbidden tools.
 * @param tools - Array of tools with name property
 * @param mode - The current agent mode
 * @returns Filtered array of allowed tools
 */
export function filterToolsByMode<T extends { name: string }>(
	tools: T[],
	mode: AgentMode | undefined,
): T[] {
	if (!mode || mode === "regular") {
		return tools;
	}

	return tools.filter((tool) => isToolAllowedForMode(tool.name, mode));
}

/**
 * Check if a tool is disabled for a specific session.
 * @param toolName - The name of the tool
 * @param disabledTools - Array of disabled tool keys in format "serverName-toolName"
 * @param serverName - The MCP server name (default: "agents-manager-mcp")
 * @returns true if the tool is disabled
 */
export function isToolDisabledForSession(
	toolName: string,
	disabledTools: string[] | undefined,
	serverName = "agents-manager-mcp",
): boolean {
	if (!disabledTools || disabledTools.length === 0) {
		return false;
	}

	const key = `${serverName}-${toolName}`;
	return disabledTools.includes(key);
}

/**
 * Build a blocking response for disallowed tools.
 */
export function buildToolBlockedResponse(
	toolName: string,
	reason: string,
): { content: Array<{ type: "text"; text: string }>; isError: true } {
	return {
		content: [
			{
				type: "text" as const,
				text: `Tool '${toolName}' is not available: ${reason}`,
			},
		],
		isError: true,
	};
}
