import {
	getSessionMcpServersLogic,
	listMcpToolsLogic,
} from "@agent-manager/shared";
import { z } from "zod";
import { getAgentManager } from "../../../application/sessions/agent-manager";
import { execFileAsync } from "../utils";
import type { ToolRegistrar } from "./types";

interface McpTool {
	name: string;
	description?: string;
}

interface ServerToolsResult {
	server: string;
	source: string;
	tools?: Array<{ name: string; description?: string }>;
	error?: string;
}

export function registerSearchTools(registerTool: ToolRegistrar) {
	registerTool(
		"search_files",
		{
			description: "Search for text in files using grep",
			inputSchema: {
				path: z
					.string()
					.describe("Absolute path to the directory to search in"),
				query: z.string().describe("Text or regex to search for"),
				includes: z
					.array(z.string())
					.optional()
					.describe("File patterns to include (e.g. ['*.ts'])"),
			},
		},
		async ({ path: searchPath, query, includes }) => {
			try {
				const args = ["-rIn"];
				if (includes) {
					for (const inc of includes as string[]) {
						args.push(`--include=${inc}`);
					}
				}
				args.push("-e", query as string);
				args.push(searchPath as string);

				const { stdout } = await execFileAsync("grep", args, {
					cwd: searchPath as string,
				});

				const limit = 300;
				const lines = stdout.split("\n");
				const output = lines.slice(0, limit).join("\n");
				const truncated = lines.length > limit;

				return {
					content: [
						{
							type: "text",
							text: output + (truncated ? "\n... (matches truncated)" : ""),
						},
					],
				};
			} catch (error: unknown) {
				// grep returns exit code 1 if not found
				if (
					error &&
					typeof error === "object" &&
					"code" in error &&
					error.code === 1
				) {
					return { content: [{ type: "text", text: "No matches found." }] };
				}
				return {
					content: [
						{
							type: "text",
							text: `Error searching files: ${error instanceof Error ? error.message : String(error)}`,
						},
					],
					isError: true,
				};
			}
		},
	);

	registerTool(
		"list_available_mcp_tools",
		{
			description:
				"List all available MCP tools across all configured servers for this session",
			inputSchema: {
				sessionId: z.string().describe("The current session ID"),
			},
		},
		async ({ sessionId }) => {
			try {
				const { sessionServers, globalServers } =
					await getSessionMcpServersLogic(
						sessionId as string,
						getAgentManager(),
					);

				const allServers = [...sessionServers, ...globalServers];
				const allTools: ServerToolsResult[] = [];

				for (const serverEntry of allServers) {
					// Skip ourselves to avoid redundant listing
					if (serverEntry.name === "agents-manager-mcp") continue;

					try {
						const tools = await listMcpToolsLogic(serverEntry);
						allTools.push({
							server: serverEntry.name,
							source: serverEntry.source,
							tools: tools.map((t: McpTool) => ({
								name: t.name,
								description: t.description,
							})),
						});
					} catch (e) {
						allTools.push({
							server: serverEntry.name,
							source: serverEntry.source,
							error: String(e),
						});
					}
				}

				return {
					content: [{ type: "text", text: JSON.stringify(allTools, null, 2) }],
				};
			} catch (error: unknown) {
				return {
					content: [
						{
							type: "text",
							text: `Error listing MCP tools: ${error instanceof Error ? error.message : String(error)}`,
						},
					],
					isError: true,
				};
			}
		},
	);
}
