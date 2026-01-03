// Types

export type { AppRouter, IAgentManager, IGtrConfigService } from "./router";
export type { McpServerEntry } from "./router/mcp";

// Router
export {
	appRouter,
	getAgentManagerOrThrow,
	getGtrConfigServiceOrThrow,
	getHandoverServiceOrThrow,
	getSessionMcpServersLogic,
	getStoreOrThrow,
	getWorktreeManagerOrThrow,
	HARDCODED_MODELS,
	listMcpToolsLogic,
	mcpRouter,
	setAgentManager,
	setGtrConfigService,
	setHandoverService,
	setNativeDialog,
	setStore,
	setWorktreeManager,
} from "./router";
export * from "./types/index";
