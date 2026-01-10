// Types

// Contracts - data shapes and typed events (Milestone 1)
export * from "./contracts";
// Ports - abstract interfaces for DI (Milestone 1)
export * from "./ports";
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
// Model fetcher utilities - pure functions that can stay in shared
export {
	buildModelId,
	MODEL_CACHE_TTL_MS,
	parseModelId,
} from "./services/model-fetcher";
export * from "./templates/handover-templates";
// Templates
export * from "./templates/mode-prompts";
export * from "./types/index";
export * from "./types/launch-config";
// Utils - export utility functions
export { generateUUID, startAgentSession, withTimeout } from "./utils";
export * from "./utils/logger";
