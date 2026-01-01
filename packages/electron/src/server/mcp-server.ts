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
import { getSessionContext, runWithSessionContext } from "./mcp-session-context";
import {
	registerFsTools,
	registerGitTools,
	registerPlanTools,
	registerSearchTools,
	registerWorktreeTools,
	type ToolRegistrar,
} from "./tools";

type ToolDescriptor = { name: string } & Record<string, unknown>;
type ToolsListResult = { tools?: ToolDescriptor[] } & Record<string, unknown>;
type InternalServer = {
	_requestHandlers?: Map<string, unknown>;
	setRequestHandler?: (
		schema: unknown,
		handler: (req: unknown, extra: unknown) => unknown | Promise<unknown>,
	) => void;
};

const isToolDescriptor = (value: unknown): value is ToolDescriptor => {
	if (!value || typeof value !== "object") return false;
	return typeof (value as { name?: unknown }).name === "string";
};

const isToolsListResult = (value: unknown): value is ToolsListResult => {
	if (!value || typeof value !== "object") return false;
	const tools = (value as { tools?: unknown }).tools;
	if (tools === undefined) return true;
	return Array.isArray(tools) && tools.every(isToolDescriptor);
};

const isInternalServer = (value: unknown): value is InternalServer => {
	if (!value || typeof value !== "object") return false;
	return "setRequestHandler" in value;
};

export async function startMcpServer(port: number = 3001) {
	const server = new McpServer({
		name: "agent-manager",
		version: "1.0.0",
	});

	// Create a tool registrar that wraps handlers with security checks
	const registerTool: ToolRegistrar = (name, schema, handler) => {
		server.registerTool(name, schema, async (args: any, extra: any) => {
			const context = getSessionContext();

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
	registerPlanTools(registerTool);
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
		const internalServer = (server as { server?: unknown }).server;
		if (!isInternalServer(internalServer)) {
			console.warn(
				"[McpServer] Failed to wrap tools/list: internal server unavailable",
			);
			return;
		}

		const originalHandler = internalServer._requestHandlers?.get("tools/list");

		if (typeof originalHandler === "function") {
			if (typeof internalServer.setRequestHandler !== "function") {
				console.warn(
					"[McpServer] Failed to wrap tools/list: setRequestHandler unavailable",
				);
				return;
			}
			console.log("[McpServer] successfully wrapped tools/list handler");
			internalServer.setRequestHandler(
				ListToolsRequestSchema,
				async (req, extra) => {
					const result: unknown = await originalHandler(req, extra);
					const context = getSessionContext();

					if (
						context?.sessionId &&
						!context.isSuperuser &&
						isToolsListResult(result) &&
						result.tools
					) {
						const conv = getStoreOrThrow().getConversation(context.sessionId);

						// Filter out disabled tools
						if (conv?.disabledMcpTools) {
							result.tools = result.tools.filter(
								(tool) =>
									!isToolDisabledForSession(
										tool.name,
										conv.disabledMcpTools,
									),
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
		const context: Parameters<StreamableHTTPTransport["handleRequest"]>[0] = c;
		return runWithSessionContext({ sessionId, isSuperuser }, () =>
			transport.handleRequest(context),
		);
	});

	// Default MCP endpoint (backward compatible)
	app.all("/mcp/*", async (c) => {
		console.log(`[McpServer] Handling MCP request: ${c.req.url}`);
		const context: Parameters<StreamableHTTPTransport["handleRequest"]>[0] = c;
		return transport.handleRequest(context);
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
