/**
 * Bootstrap - Application initialization and dependency wiring
 *
 * This is the entry point for Milestone 3: Build ctx in electron.
 *
 * The bootstrap module:
 * 1. Creates all service instances
 * 2. Builds the RouterContext
 * 3. Creates the router using the factory
 * 4. Wires up adapters (oRPC, IPC, etc.)
 *
 * This replaces the scattered setAgentManager/setStore calls in main.ts.
 *
 * @example
 * // In main.ts:
 * import { bootstrap } from './app/bootstrap';
 *
 * app.whenReady().then(async () => {
 *   const { router, ctx } = await bootstrap();
 *   // router is ready to use
 * });
 */

import { createRouter, type RouterContext } from "@agent-manager/shared";
import { dialog } from "electron";

import { AgentEventServiceAdapter } from "../application/services/agent-event-service";
import { ThemeServiceAdapter } from "../application/services/theme-service";
import {
	setAgentManager as setElectronAgentManager,
	unifiedAgentManager,
} from "../application/sessions";
import { devServerManager } from "../infrastructure/dev-server/dev-server-manager";
import { store } from "../infrastructure/store";
import { worktreeManager } from "../infrastructure/worktree/worktree-manager";
import { branchNamePromptService } from "../services/branch-name-service";
import { GtrConfigService } from "../services/gtr-config-service";
import * as handoverSummaryService from "../services/handover-summary-service";
import { webServerManager } from "../services/web-server-manager";

/**
 * NativeDialog adapter for Electron
 */
const nativeDialogAdapter = {
	selectDirectory: async () => {
		const result = await dialog.showOpenDialog({
			properties: ["openDirectory"],
		});
		if (result.canceled) return null;
		return result.filePaths[0] ?? null;
	},

	selectPaths: async ({
		type,
		multiple,
	}: {
		type: "file" | "dir" | "any";
		multiple?: boolean;
	}) => {
		const properties: Array<"openFile" | "openDirectory" | "multiSelections"> =
			[];
		if (type === "file") properties.push("openFile");
		if (type === "dir") properties.push("openDirectory");
		if (type === "any") properties.push("openFile", "openDirectory");
		if (multiple) properties.push("multiSelections");
		const result = await dialog.showOpenDialog({ properties });
		if (result.canceled) return [];
		return result.filePaths;
	},
};

/**
 * Bootstrap result - provides access to the router and context
 */
export interface BootstrapResult {
	router: ReturnType<typeof createRouter>;
	ctx: RouterContext;
}

/**
 * Initialize the application with all dependencies.
 *
 * This function:
 * 1. Creates service instances
 * 2. Builds the RouterContext
 * 3. Creates the router via factory
 *
 * @returns The router and context for further setup
 */
export function bootstrap(): BootstrapResult {
	// Create service instances
	const gtrConfigService = new GtrConfigService();
	const themeService = new ThemeServiceAdapter();
	const agentEventService = new AgentEventServiceAdapter();

	// Import and create rules resolver (Milestone 4)
	const {
		createRulesService,
		createModelFetcher,
		createSessionBuilder,
	} = require("../application/services");
	const rulesService = createRulesService(store);

	// Create model fetcher service (Milestone 4)
	const modelFetcher = createModelFetcher();

	// Create session builder service (Milestone 4)
	// Note: sessionBuilder depends on store and rulesResolver
	const sessionBuilder = createSessionBuilder(store, rulesService);

	// Build the RouterContext with all dependencies
	const ctx: RouterContext = {
		agentManager: unifiedAgentManager,
		store: store,
		worktreeManager: worktreeManager,
		nativeDialog: nativeDialogAdapter,
		devServerService: devServerManager,
		webServerService: webServerManager,
		handoverService: handoverSummaryService,
		gtrConfigService: gtrConfigService,
		rulesService: rulesService,
		rulesResolver: rulesService, // Compatible interface
		modelFetcher: modelFetcher,
		sessionBuilder: sessionBuilder,
		themeService: themeService,
		branchNameService: branchNamePromptService,
		agentEventService: agentEventService,
	};

	// Set up the unified agent manager for internal electron usage
	setElectronAgentManager(unifiedAgentManager);

	// Create router using the factory pattern
	// createRouter(ctx) internally calls _setRouterContext(ctx),
	// enabling handlers to use getRouterContext() for migration
	const router = createRouter(ctx);

	return { router, ctx };
}

/**
 * Get the store instance (for initialization in main.ts)
 *
 * @returns The file store instance
 */
export function getStore() {
	return store;
}
