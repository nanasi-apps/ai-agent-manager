import { AsyncLocalStorage } from "node:async_hooks";
import { getStoreOrThrow } from "@agent-manager/shared";
import { StreamableHTTPTransport } from "@hono/mcp";
import { serve } from "@hono/node-server";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { Hono } from "hono";
import { getAgentManager } from "../agents/agent-manager";
import {
	registerFsTools,
	registerGitTools,
	registerSearchTools,
	registerWorktreeTools,
	type ToolRegistrar,
} from "./tools";

const sessionContext = new AsyncLocalStorage<{
	sessionId: string;
	isSuperuser: boolean;
}>();

export async function startMcpServer(port: number = 3001) {
	const server = new McpServer({
		name: "agent-manager",
		version: "1.0.0",
	});

	// Create a tool registrar that wraps handlers with security checks
	const registerTool: ToolRegistrar = (name, schema, handler) => {
		server.registerTool(name, schema, async (args: any, extra: any) => {
			const context = sessionContext.getStore();

			if (context?.sessionId) {
				const conv = getStoreOrThrow().getConversation(context.sessionId);
				// Check exact match "agents-manager-mcp-{toolName}" as stored by UI
				const key = `agents-manager-mcp-${name}`;
				if (conv?.disabledMcpTools?.includes(key)) {
					console.log(
						`[McpServer] Blocking disabled tool ${name} for session ${context.sessionId}`,
					);
					return {
						content: [
							{
								type: "text" as const,
								text: `Tool '${name}' is disabled for this session by the user.`,
							},
						],
						isError: true,
					};
				}

				// Check Plan Mode via active session config
				const manager = getAgentManager();
				const config = manager.getSessionConfig?.(context.sessionId);
				if (config?.mode === "plan" || config?.mode === "ask") {
					// Plan/Ask mode: strictly forbid file operations and git
					const forbiddenPatterns = [
						"write_file",
						"replace_file_content",
						"git_add",
						"git_commit",
						"git_checkout",
						"worktree_create",
						"worktree_remove",
						"worktree_complete",
						"worktree_run",
						"run_command",
					];
					if (forbiddenPatterns.some((p) => name.startsWith(p))) {
						console.log(
							`[McpServer] Blocking tool ${name} for session ${context.sessionId} (${config.mode} Mode)`,
						);
						return {
							content: [
								{
									type: "text" as const,
									text: `Tool '${name}' is not available in ${config.mode} Mode.`,
								},
							],
							isError: true,
						};
					}
				}
			}
			return handler(args, extra);
		});
	};

	// Register all tools from modular files
	registerFsTools(registerTool);
	registerGitTools(registerTool);
	registerWorktreeTools(registerTool);
	registerSearchTools(registerTool);

	const app = new Hono();
	const transport = new StreamableHTTPTransport({});

	await server.connect(transport);

	// Middleware to log all requests
	app.use("*", async (c, next) => {
		console.log(`[McpServer] ${c.req.method} ${c.req.url}`);
		await next();
		console.log(`[McpServer] Response status: ${c.res.status}`);
	});

	// Wrap tools/list handler to filter disabled tools
	setTimeout(() => {
		const internalServer = (server as any).server;
		const originalHandler = internalServer._requestHandlers?.get("tools/list");

		if (originalHandler) {
			console.log("[McpServer] successfully wrapped tools/list handler");
			internalServer.setRequestHandler(
				ListToolsRequestSchema,
				async (req: any, extra: any) => {
					const result = await originalHandler(req, extra);
					const context = sessionContext.getStore();

					if (context?.sessionId && !context.isSuperuser && result.tools) {
						const conv = getStoreOrThrow().getConversation(context.sessionId);
						if (conv?.disabledMcpTools) {
							result.tools = result.tools.filter(
								(t: any) =>
									!conv.disabledMcpTools!.includes(`agents-manager-mcp-${t.name}`),
							);
						}

						// Plan/Ask Mode: Filter out action tools from the list
						const manager = getAgentManager();
						const config = manager.getSessionConfig?.(context.sessionId);
						if (config?.mode === "plan" || config?.mode === "ask") {
							result.tools = result.tools.filter((t: any) => {
								const forbiddenPatterns = [
									"write_file",
									"replace_file_content",
									"git_add",
									"git_commit",
									"git_checkout",
									"worktree_create",
									"worktree_remove",
									"worktree_complete",
									"worktree_run",
									"run_command",
								];
								return !forbiddenPatterns.some((pattern) =>
									t.name.startsWith(pattern),
								);
							});
						}
					}
					return result;
				},
			);
		} else {
			console.warn(
				"[McpServer] Failed to wrap tools/list: original handler not found",
			);
		}
	}, 100);

	// Session-specific MCP endpoint: /mcp/:sessionId/*
	app.all("/mcp/:sessionId/*", async (c) => {
		const sessionId = c.req.param("sessionId");
		const isSuperuser = c.req.query("superuser") === "true";
		return sessionContext.run({ sessionId, isSuperuser }, () =>
			transport.handleRequest(c as any),
		);
	});

	// Default MCP endpoint (backward compatible)
	app.all("/mcp/*", async (c) => {
		console.log(`[McpServer] Handling MCP request: ${c.req.url}`);
		return transport.handleRequest(c as any);
	});

	// Health check
	app.get("/health", (c) => c.text("OK"));

	console.log(`[McpServer] Starting on port ${port}`);

	serve({
		fetch: app.fetch,
		port,
	});

	return app;
}
