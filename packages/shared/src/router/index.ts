/**
 * @deprecated Internal - Legacy DI functions for backward compatibility.
 * Do not use in new code.
 */

import type {
	IAgentManager,
	IGtrConfigService,
	INativeDialog,
	IWebServerService,
	IWebServerStatus,
} from "../services/dependency-container";
import {
	getAgentManagerOrThrow,
	getDevServerServiceOrThrow,
	getGtrConfigServiceOrThrow,
	getHandoverServiceOrThrow,
	getNativeDialog,
	getStoreOrThrow,
	getWebServerServiceOrThrow,
	getWorktreeManagerOrThrow,
} from "../services/dependency-container";
import { createRouter, type RouterContext } from "./createRouter";
import { createMcpRouter } from "./mcp";

// Type exports only - no deprecated function exports
export type {
	IAgentManager,
	IGtrConfigService,
	INativeDialog,
	IWebServerService,
	IWebServerStatus,
};

// Re-export model utilities
export {
	buildModelId,
	HARDCODED_MODELS,
	parseModelId,
} from "../services/model-fetcher";
// Re-export utilities
export { generateUUID } from "../utils";
export type { AppRouterFromFactory, RouterContext } from "./createRouter";
// Re-export the new factory-based router (Milestone 2)
// This is the preferred way to create routers going forward
export { createRouter, getRouterContext } from "./createRouter";

/**
 * Creates a legacy router context using global DI.
 * @deprecated Internal use only - for backward compatibility with appRouter.
 */
function createLegacyRouterContext(): RouterContext {
	return {
		get agentManager() {
			return getAgentManagerOrThrow();
		},
		get store() {
			return getStoreOrThrow();
		},
		get worktreeManager() {
			return getWorktreeManagerOrThrow();
		},
		get nativeDialog() {
			return getNativeDialog();
		},
		get devServerService() {
			return getDevServerServiceOrThrow();
		},
		get webServerService() {
			return getWebServerServiceOrThrow();
		},
		get handoverService() {
			return getHandoverServiceOrThrow();
		},
		get gtrConfigService() {
			return getGtrConfigServiceOrThrow();
		},
		rulesService: undefined,
		rulesResolver: undefined,
		modelFetcher: undefined,
		sessionBuilder: undefined,
	};
}

const legacyCtx = createLegacyRouterContext();

/**
 * @deprecated Internal - Legacy MCP router using global DI.
 */
export const mcpRouter = createMcpRouter(legacyCtx);
export { getSessionMcpServersLogic, listMcpToolsLogic } from "./mcp";

/**
 * Legacy app router - uses global DI via dependency-container.
 *
 * @deprecated For new code, use {@link createRouter} with explicit context.
 * This export remains for backwards compatibility.
 *
 * Migration path:
 * 1. Build RouterContext in electron bootstrap
 * 2. Call createRouter(ctx) instead of importing appRouter
 * 3. The behavior is identical; only the DI mechanism changes
 */
export const appRouter = createRouter(legacyCtx);

export type AppRouter = typeof appRouter;
