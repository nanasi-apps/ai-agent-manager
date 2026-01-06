import * as fs from "node:fs/promises";
import { homedir } from "node:os";
import * as path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { os } from "@orpc/server";
import { z } from "zod";
import { getAgentManagerOrThrow } from "../services/dependency-container";

// MCP Server config types
export interface McpServerEntry {
	name: string;
	source: "gemini" | "claude-desktop" | "claude-code" | "agent-manager";
	enabled: boolean;
	config: {
		url?: string;
		command?: string;
		args?: string[];
		type?: string;
	};
}

// Schema for MCP server entry output
const mcpServerEntrySchema = z.object({
	name: z.string(),
	source: z.enum(["gemini", "claude-desktop", "claude-code", "agent-manager"]),
	enabled: z.boolean(),
	config: z.object({
		url: z.string().optional(),
		command: z.string().optional(),
		args: z.array(z.string()).optional(),
		type: z.string().optional(),
	}),
});

/**
 * Read MCP servers from a Gemini settings.json file
 */
async function readMcpServersFromGeminiConfig(
	settingsPath: string,
	source: McpServerEntry["source"] = "gemini",
): Promise<McpServerEntry[]> {
	const entries: McpServerEntry[] = [];

	try {
		const content = await fs.readFile(settingsPath, "utf-8");
		const settings = JSON.parse(content) as {
			mcpServers?: Record<string, { url?: string }>;
		};

		if (settings.mcpServers) {
			for (const [name, config] of Object.entries(settings.mcpServers)) {
				entries.push({
					name,
					source,
					enabled: true,
					config: {
						url: config.url,
					},
				});
			}
		}
	} catch (e) {
		// File doesn't exist or invalid JSON - that's fine
	}

	return entries;
}

/**
 * Read MCP servers from a Claude config.json file
 */
async function readMcpServersFromClaudeConfig(
	configPath: string,
	source: McpServerEntry["source"] = "claude-code",
): Promise<McpServerEntry[]> {
	const entries: McpServerEntry[] = [];

	try {
		const content = await fs.readFile(configPath, "utf-8");
		const config = JSON.parse(content) as {
			mcpServers?: Record<
				string,
				{ command?: string; args?: string[]; url?: string; type?: string }
			>;
		};

		if (config.mcpServers) {
			for (const [name, serverConfig] of Object.entries(config.mcpServers)) {
				entries.push({
					name,
					source,
					enabled: true,
					config: {
						command: serverConfig.command,
						args: serverConfig.args,
						url: serverConfig.url,
						type: serverConfig.type,
					},
				});
			}
		}
	} catch (e) {
		// File doesn't exist or invalid JSON
	}

	return entries;
}

/**
 * Read Gemini CLI MCP configuration from ~/.gemini/settings.json
 */
async function readGeminiMcpServers(): Promise<McpServerEntry[]> {
	const settingsPath = path.join(homedir(), ".gemini", "settings.json");
	return readMcpServersFromGeminiConfig(settingsPath, "gemini");
}

/**
 * Read Claude Desktop MCP configuration
 */
async function readClaudeDesktopMcpServers(): Promise<McpServerEntry[]> {
	let configPath: string;
	if (process.platform === "darwin") {
		configPath = path.join(
			homedir(),
			"Library",
			"Application Support",
			"Claude",
			"claude_desktop_config.json",
		);
	} else if (process.platform === "win32") {
		configPath = path.join(
			process.env.APPDATA || path.join(homedir(), "AppData", "Roaming"),
			"Claude",
			"claude_desktop_config.json",
		);
	} else {
		configPath = path.join(
			homedir(),
			".config",
			"Claude",
			"claude_desktop_config.json",
		);
	}

	return readMcpServersFromClaudeConfig(configPath, "claude-desktop");
}

/**
 * Read Claude Code MCP configuration from ~/.claude/settings.json
 */
async function readClaudeCodeMcpServers(): Promise<McpServerEntry[]> {
	const settingsPath = path.join(homedir(), ".claude", "settings.json");
	return readMcpServersFromClaudeConfig(settingsPath, "claude-code");
}

/**
 * Read MCP servers from a session's temporary config directories
 * These include the injected agent-manager MCP server
 */
async function readSessionMcpServers(
	geminiHome?: string,
	claudeHome?: string,
): Promise<McpServerEntry[]> {
	const entries: McpServerEntry[] = [];

	// Read from session's Gemini config
	if (geminiHome) {
		const settingsPath = path.join(geminiHome, ".gemini", "settings.json");
		const geminiServers = await readMcpServersFromGeminiConfig(
			settingsPath,
			"agent-manager",
		);
		entries.push(...geminiServers);
	}

	// Read from session's Claude config
	if (claudeHome) {
		const configPath = path.join(claudeHome, "config.json");
		const claudeServers = await readMcpServersFromClaudeConfig(
			configPath,
			"agent-manager",
		);
		entries.push(...claudeServers);
	}

	return entries;
}

/**
 * Get MCP servers for a specific session
 */
export async function getSessionMcpServersLogic(sessionId: string): Promise<{
	sessionServers: McpServerEntry[];
	globalServers: McpServerEntry[];
	agentType?: string;
}> {
	const agentManager = getAgentManagerOrThrow();

	// Get session homes for reading session-specific MCP config
	const homes = agentManager.getSessionHomes?.(sessionId);

	// Determine agent type from session config
	const config = agentManager.getSessionConfig?.(sessionId);
	const agentType = config?.type;

	// Read session-specific MCP servers from config files (if session exists)
	let sessionServers = await readSessionMcpServers(
		homes?.geminiHome,
		homes?.claudeHome,
	);

	// Always include the agent-manager MCP server for this session
	// even if session doesn't exist in memory yet (e.g., after app restart)
	const agentManagerMcpUrl = `http://localhost:3001/mcp/${sessionId}/sse`;
	const hasAgentManagerMcp = sessionServers.some(
		(s) =>
			s.name === "agents-manager-mcp" ||
			s.config.url?.includes(`/mcp/${sessionId}/`),
	);

	if (!hasAgentManagerMcp) {
		sessionServers = [
			{
				name: "agents-manager-mcp",
				source: "agent-manager",
				enabled: true,
				config: {
					url: agentManagerMcpUrl,
				},
			},
			...sessionServers,
		];
	}

	// Read global servers based on agent type
	let globalServers: McpServerEntry[] = [];
	if (agentType === "gemini" || !agentType) {
		globalServers = await readGeminiMcpServers();
	} else if (agentType === "claude") {
		globalServers = await readClaudeCodeMcpServers();
	}

	return {
		sessionServers,
		globalServers,
		agentType,
	};
}

/**
 * List tools for a specific MCP server
 */
export async function listMcpToolsLogic(input: McpServerEntry): Promise<any[]> {
	console.log(
		`[McpLogic] Listing tools for ${input.name} (${input.config.url || input.config.command})`,
	);
	let client: Client | undefined;
	try {
		if (input.config.url) {
			// Convert SSE URL to base URL for StreamableHTTPClientTransport
			// e.g., http://localhost:3001/mcp/sessionId/sse -> http://localhost:3001/mcp/sessionId
			let baseUrl = input.config.url;
			if (baseUrl.endsWith("/sse")) {
				baseUrl = baseUrl.slice(0, -4);
			}
			const transport = new StreamableHTTPClientTransport(new URL(baseUrl));
			client = new Client(
				{ name: "agent-manager", version: "1.0.0" },
				{ capabilities: {} },
			);
			await client.connect(transport);
			const result = await client.listTools();
			return result.tools;
		} else if (input.config.command) {
			const transport = new StdioClientTransport({
				command: input.config.command,
				args: input.config.args || [],
			});
			client = new Client(
				{ name: "agent-manager", version: "1.0.0" },
				{ capabilities: {} },
			);
			await client.connect(transport);
			const result = await client.listTools();
			await client.close();
			return result.tools;
		}
	} catch (e) {
		console.error(`[McpLogic] Failed to list tools for ${input.name}:`, e);
		return [];
	} finally {
		if (client) {
			try {
				await client.close();
			} catch (e) {
				// Ignore close errors
			}
		}
	}
	return [];
}

export const mcpRouter = {
	/**
	 * List all configured MCP servers from global Gemini CLI and Claude CLI settings
	 */
	listMcpServers: os.output(z.array(mcpServerEntrySchema)).handler(async () => {
		const [gemini, claudeDesktop, claudeCode] = await Promise.all([
			readGeminiMcpServers(),
			readClaudeDesktopMcpServers(),
			readClaudeCodeMcpServers(),
		]);

		return [...gemini, ...claudeDesktop, ...claudeCode];
	}),

	/**
	 * Get MCP servers grouped by source
	 */
	getMcpServersBySource: os
		.output(
			z.object({
				gemini: z.array(mcpServerEntrySchema),
				claudeDesktop: z.array(mcpServerEntrySchema),
				claudeCode: z.array(mcpServerEntrySchema),
			}),
		)
		.handler(async () => {
			const [gemini, claudeDesktop, claudeCode] = await Promise.all([
				readGeminiMcpServers(),
				readClaudeDesktopMcpServers(),
				readClaudeCodeMcpServers(),
			]);

			return {
				gemini,
				claudeDesktop,
				claudeCode,
			};
		}),

	/**
	 * Get MCP servers for a specific session
	 * Includes both global servers and session-specific injected servers
	 */
	getSessionMcpServers: os
		.input(z.object({ sessionId: z.string() }))
		.output(
			z.object({
				sessionServers: z.array(mcpServerEntrySchema),
				globalServers: z.array(mcpServerEntrySchema),
				agentType: z.string().optional(),
			}),
		)
		.handler(async ({ input }) => {
			return getSessionMcpServersLogic(input.sessionId);
		}),

	/**
	 * List tools for a specific MCP server
	 */
	listMcpTools: os
		.input(mcpServerEntrySchema)
		.output(z.array(z.any()))
		.handler(async ({ input }) => {
			return listMcpToolsLogic(input);
		}),
};
