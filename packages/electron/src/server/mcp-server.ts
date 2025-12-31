import { AsyncLocalStorage } from "node:async_hooks";
import type { AgentMode } from "@agent-manager/shared";
import { getStoreOrThrow } from "@agent-manager/shared";
import { StreamableHTTPTransport } from "@hono/mcp";
import { serve } from "@hono/node-server";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { Hono } from "hono";
import { getAgentManager } from "../agents/agent-manager";
import {
	buildToolBlockedResponse,
	filterToolsByMode,
	isToolAllowedForMode,
	isToolDisabledForSession,
} from "./tool-policy";
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

				// Check if tool is disabled by user
				if (isToolDisabledForSession(name, conv?.disabledMcpTools)) {
					console.log(
						`[McpServer] Blocking disabled tool ${name} for session ${context.sessionId}`,
					);
					return buildToolBlockedResponse(
						name,
						"disabled for this session by the user",
					);
				}

				// Check Plan/Ask Mode restrictions
				const manager = getAgentManager();
				const config = manager.getSessionConfig?.(context.sessionId);
				const mode = config?.mode as AgentMode | undefined;

				if (!isToolAllowedForMode(name, mode)) {
					console.log(
						`[McpServer] Blocking tool ${name} for session ${context.sessionId} (${mode} Mode)`,
					);
					return buildToolBlockedResponse(
						name,
						`not available in ${mode} Mode`,
					);
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

						// Filter out disabled tools
						if (conv?.disabledMcpTools) {
							result.tools = result.tools.filter(
								(t: any) =>
									!isToolDisabledForSession(t.name, conv.disabledMcpTools),
							);
						}

						// Filter by mode (Plan/Ask Mode restrictions)
						const manager = getAgentManager();
						const config = manager.getSessionConfig?.(context.sessionId);
						const mode = config?.mode as AgentMode | undefined;
						result.tools = filterToolsByMode(result.tools, mode);
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
