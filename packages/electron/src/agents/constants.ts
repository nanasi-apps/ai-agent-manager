/**
 * Constants for agent management
 */

/** Internal MCP server URL for agent integration */
export const MCP_SERVER_URL = "http://localhost:3001/mcp/sse";

/** Agent type identifiers */
export const AGENT_TYPES = {
	GEMINI: "gemini",
	CLAUDE: "claude",
	CODEX: "codex",
	CUSTOM: "custom",
	CAT: "cat",
} as const;

export type AgentTypeKey = keyof typeof AGENT_TYPES;
