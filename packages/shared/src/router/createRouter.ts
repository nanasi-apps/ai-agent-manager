/**
 * createRouter - Factory function for creating the oRPC router
 *
 * This is the entry point for Milestone 2: Convert shared router into factory.
 *
 * Instead of relying on global DI (setAgentManager, setStore, etc.),
 * the router now accepts a context object with all dependencies.
 *
 * MIGRATION STRATEGY:
 * 1. This file defines the context interface and creates the router
 * 2. Sub-routers are gradually converted to accept context via factories
 * 3. The old `appRouter` in `index.ts` remains as a compatibility wrapper
 * 4. Eventually, electron calls `createRouter(ctx)` directly
 *
 * @example
 * // In electron bootstrap:
 * import { createRouter } from '@agent-manager/shared/router/createRouter';
 *
 * const ctx = {
 *   agentManager: unifiedAgentManager,
 *   store: fileStore,
 *   worktreeManager: worktreeManager,
 *   // ...
 * };
 *
 * const router = createRouter(ctx);
 * setupOrpc(router);
 */

import { os } from "@orpc/server";
import { z } from "zod";

// Import port interfaces (these define the "what", not "how")
import type { IAgentManager } from "../ports/agent-manager";
import type { IDevServerService } from "../ports/dev-server-service";
import type { IGtrConfigService } from "../ports/gtr-config-service";
import type { IHandoverService } from "../ports/handover-service";
import type { IModelFetcher } from "../ports/model-fetcher";
import type { INativeDialog } from "../ports/native-dialog";
import type { IRulesResolver } from "../ports/rules-resolver";
import type { IRulesService } from "../ports/rules-service";
import type { ISessionBuilder } from "../ports/session-builder";
import type { IStore } from "../ports/store";
import type { IWebServerService } from "../ports/web-server-service";
import type { IWorktreeManager } from "../ports/worktree-manager";
import { createAgentsRouter } from "./agents";
import { createApiSettingsRouter } from "./api-settings";
import { createAppSettingsRouter } from "./app-settings";
import { createApprovalsRouter } from "./approvals";
import { createConversationsRouter } from "./conversations";
import { createDevServerRouter } from "./dev-server";
import { createLocksRouter } from "./locks";
import { createMcpRouter } from "./mcp";
import { createModelsRouter } from "./models";
import { createProjectsRouter } from "./projects";
import { createRulesRouter } from "./rules";
import { createWebServerRouter } from "./web-server";
import { createWorktreesRouter } from "./worktrees";

/**
 * RouterContext - All dependencies needed by the router
 *
 * This interface defines what services the router needs to function.
 * The electron package is responsible for creating and providing these.
 */
export interface RouterContext {
	/** Agent session management */
	agentManager: IAgentManager;

	/** Persistent storage for projects, conversations, etc. */
	store: IStore;

	/** Git worktree operations */
	worktreeManager: IWorktreeManager;

	/** Native OS dialogs (optional - null in web context) */
	nativeDialog: INativeDialog | null;

	/** Development server management */
	devServerService: IDevServerService;

	/** Web server management */
	webServerService: IWebServerService;

	/** Agent handover/summary generation */
	handoverService: IHandoverService;

	/** GTR configuration management */
	gtrConfigService: IGtrConfigService;

	/**
	 * Rules service for managing and resolving rules (Supersedes rulesResolver)
	 */
	rulesService?: IRulesService;

	/**
	 * Rules resolution for projects (deprecated, use rulesService)
	 * @deprecated Use rulesService instead
	 */
	rulesResolver?: IRulesResolver;

	/** Model fetching service (optional during migration) */
	modelFetcher?: IModelFetcher;

	/** Session configuration builder (optional during migration) */
	sessionBuilder?: ISessionBuilder;
}

/**
 * Creates the oRPC app router with the given context.
 *
 * This is the factory function that replaces the global DI pattern.
 * All sub-routers receive their dependencies via the context object.
 *
 * @param ctx - The router context with all dependencies
 * @returns The composed oRPC router
 */
export function createRouter(ctx: RouterContext) {
	// Create sub-routers with explicit context
	const agentsRouter = createAgentsRouter(ctx);
	const apiSettingsRouter = createApiSettingsRouter(ctx);
	const appSettingsRouter = createAppSettingsRouter(ctx);
	const approvalsRouter = createApprovalsRouter(ctx);
	const conversationsRouter = createConversationsRouter(ctx);
	const devServerRouter = createDevServerRouter(ctx);
	const locksRouter = createLocksRouter(ctx);
	const mcpRouter = createMcpRouter(ctx);
	const modelsRouter = createModelsRouter(ctx);
	const projectsRouter = createProjectsRouter(ctx);
	const rulesRouter = createRulesRouter(ctx);
	const webServerRouter = createWebServerRouter(ctx);
	const worktreesRouter = createWorktreesRouter(ctx);

	// Store context in a way that the migrated handlers can access
	// This is a transition mechanism - eventually all handlers get ctx directly
	_setRouterContext(ctx);

	return os.router({
		// Core endpoints
		ping: os
			.input(z.void())
			.output(z.string())
			.handler(async () => {
				console.log("Ping received on server");
				return "pong from electron (ORPC)";
			}),

		getPlatform: os
			.output(z.enum(["electron", "web"]))
			.handler(async () => "electron" as const),

		// Legacy routers (still using global DI, but called via factory)
		...rulesRouter,
		...appSettingsRouter,
		...apiSettingsRouter,
		...projectsRouter,
		...modelsRouter,
		...conversationsRouter,
		...worktreesRouter,
		...locksRouter,
		...agentsRouter,
		...mcpRouter,
		...approvalsRouter,
		...devServerRouter,
		...webServerRouter,
	});
}

/**
 * Internal context storage for transition period.
 *
 * This allows us to migrate handlers incrementally:
 * - New handlers can use getRouterContext() instead of getXxxOrThrow()
 * - Eventually, handlers receive ctx directly as a parameter
 *
 * TODO: Remove this once all handlers are migrated to accept ctx directly
 */
let _routerContext: RouterContext | null = null;

function _setRouterContext(ctx: RouterContext): void {
	_routerContext = ctx;
}

/**
 * Get the current router context (for transition period).
 *
 * @deprecated Use ctx parameter directly in handler factories
 */
export function getRouterContext(): RouterContext {
	if (!_routerContext) {
		throw new Error(
			"Router context not initialized. Call createRouter(ctx) first.",
		);
	}
	return _routerContext;
}

/**
 * Type export for the router created by createRouter
 */
export type AppRouterFromFactory = ReturnType<typeof createRouter>;
