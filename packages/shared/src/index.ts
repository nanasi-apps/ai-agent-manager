// Types

export type { AppRouter, IAgentManager } from "./router";
export type { McpServerEntry } from "./router/mcp";

// Router
export {
	appRouter,
	getHandoverServiceOrThrow,
	getSessionMcpServersLogic,
	getStoreOrThrow,
	HARDCODED_MODELS,
	listMcpToolsLogic,
	mcpRouter,
	setAgentManager,
	setHandoverService,
	setNativeDialog,
	setStore,
	setWorktreeManager,
} from "./router";
export * from "./types/index";
