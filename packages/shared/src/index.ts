// Types

export type { AppRouter, IAgentManager, IGtrConfigService, IWebServerService, IWebServerStatus } from "./router";
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
	setDevServerService,
	setWebServerService,
} from "./router";
export * from "./types/index";
export * from "./types/launch-config";
export * from "./utils/logger";
