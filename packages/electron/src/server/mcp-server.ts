import type { AgentLogPayload, AgentMode } from "@agent-manager/shared";
import { getStoreOrThrow } from "@agent-manager/shared";
import { randomUUID } from "node:crypto";
import { BrowserWindow } from "electron";
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
import type { ToolResult } from "./tools/types";

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

const planToolNames = new Set(["planning_create", "propose_implementation_plan"]);

function generateFallbackUUID(): string {
	return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
		const r = (Math.random() * 16) | 0;
		const v = c === "x" ? r : (r & 0x3) | 0x8;
		return v.toString(16);
	});
}

function generateId(): string {
	try {
		return randomUUID();
	} catch {
		return generateFallbackUUID();
	}
}

function emitAgentLog(payload: AgentLogPayload, persist: boolean = true) {
	if (persist) {
		const store = getStoreOrThrow();
		const role = payload.type === "system" ? "system" : "agent";
		store.addMessage(payload.sessionId, {
			id: generateId(),
			role,
			content: payload.data,
			timestamp: Date.now(),
			logType: payload.type,
		});
	}

	BrowserWindow.getAllWindows().forEach((win) => {
		win.webContents.send("agent-log", payload);
	});
}

function formatToolCall(name: string, args: unknown): string {
	const params = args ?? {};
	return `\n[Tool: ${name}]\n${JSON.stringify(params, null, 2)}\n`;
}

function formatToolResult(result: ToolResult): string {
	const text = result.content?.map((item) => item.text).join("\n") ?? "";
	if (!text.trim()) return "[Result]\n";
	return `[Result]\n${text}\n`;
}

function extractPlanContent(args: unknown): string | null {
	if (!args || typeof args !== "object") return null;
	const planContent = (args as { planContent?: unknown }).planContent;
	if (typeof planContent !== "string") return null;
	return planContent.trim() ? planContent : null;
}

function hasPlanContent(
	sessionId: string,
	planContent: string,
): boolean {
	const messages = getStoreOrThrow().getMessages(sessionId);
	for (let i = messages.length - 1; i >= 0; i--) {
		const msg = messages[i];
		if (msg?.logType === "plan" && msg.content?.trim()) {
			return msg.content.trim() === planContent.trim();
		}
	}
	return false;
}

export async function startMcpServer(port: number = 3001) {
	const server = new McpServer({
		name: "agent-manager",
		version: "1.0.0",
	});

	// Create a tool registrar that wraps handlers with security checks
	const registerTool: ToolRegistrar = (name, schema, handler) => {
		server.registerTool(name, schema, async (args: any, extra: any) => {
			const context = getSessionContext();
			const sessionId = context?.sessionId;

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

			if (sessionId) {
				emitAgentLog({
					sessionId,
					data: formatToolCall(name, args),
					type: "tool_call",
				});
			}

			try {
				const result = await handler(args, extra);

				if (sessionId) {
					if (planToolNames.has(name)) {
						const planContent = extractPlanContent(args);
						if (planContent) {
							const persist = !hasPlanContent(sessionId, planContent);
							emitAgentLog(
								{
									sessionId,
									data: planContent,
									type: "plan",
								},
								persist,
							);
						}
					}

					emitAgentLog({
						sessionId,
						data: formatToolResult(result),
						type: result.isError ? "error" : "tool_result",
					});
				}

				return result;
			} catch (error: unknown) {
				if (sessionId) {
					emitAgentLog({
						sessionId,
						data: `[Error] ${error instanceof Error ? error.message : String(error)}\n`,
						type: "error",
					});
				}
				throw error;
			}
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
