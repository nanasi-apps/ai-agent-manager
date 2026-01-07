// Types

export type {
	AppRouter,
	AppRouterFromFactory,
	IAgentManager,
	IGtrConfigService,
	IWebServerService,
	IWebServerStatus,
	RouterContext,
} from "./router";
// Router
export {
	appRouter,
	createRouter,
	getAgentManagerOrThrow,
	getGtrConfigServiceOrThrow,
	getHandoverServiceOrThrow,
	getRouterContext,
	getSessionMcpServersLogic,
	getStoreOrThrow,
	getWorktreeManagerOrThrow,
	HARDCODED_MODELS,
	listMcpToolsLogic,
	mcpRouter,
	setAgentManager,
	setDevServerService,
	setGtrConfigService,
	setHandoverService,
	setNativeDialog,
	setStore,
	setWebServerService,
	setWorktreeManager,
} from "./router";
export type { McpServerEntry } from "./router/mcp";
export * from "./types/index";
export * from "./types/launch-config";
export * from "./utils/logger";

// Ports - abstract interfaces for DI (Milestone 1)
export * from "./ports";

// Contracts - data shapes and typed events (Milestone 1)
export * from "./contracts";
