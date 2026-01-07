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

import { dialog } from "electron";
import {
    appRouter,
    type AppRouter,
    type RouterContext,
    // Legacy setters - still needed during transition for handlers using global DI
    setAgentManager,
    setDevServerService,
    setGtrConfigService,
    setHandoverService,
    setNativeDialog,
    setStore,
    setWebServerService,
    setWorktreeManager,
} from "@agent-manager/shared";

import {
    setAgentManager as setElectronAgentManager,
    unifiedAgentManager,
} from "../agents";
import { devServerManager } from "../main/dev-server-manager";
import { worktreeManager } from "../main/worktree-manager";
import { GtrConfigService } from "../services/gtr-config-service";
import * as handoverSummaryService from "../services/handover-summary-service";
import { webServerManager } from "../services/web-server-manager";
import { store } from "../store";

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
    }: { type: "file" | "dir" | "any"; multiple?: boolean }) => {
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
    router: AppRouter;
    ctx: RouterContext;
}

/**
 * Initialize the application with all dependencies.
 *
 * This function:
 * 1. Creates service instances
 * 2. Builds the RouterContext
 * 3. Creates the router via factory
 * 4. Sets up legacy global DI for transition period
 *
 * @returns The router and context for further setup
 */
export function bootstrap(): BootstrapResult {
    // Create service instances
    const gtrConfigService = new GtrConfigService();

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
    };

    // TRANSITION: Also set up legacy global DI
    // TODO: Remove these once all handlers use ctx directly
    setAgentManager(unifiedAgentManager);
    setElectronAgentManager(unifiedAgentManager);
    setStore(store);
    setWorktreeManager(worktreeManager);
    setHandoverService(handoverSummaryService);
    setGtrConfigService(gtrConfigService);
    setDevServerService(devServerManager);
    setWebServerService(webServerManager);
    setNativeDialog(nativeDialogAdapter);

    // Use the legacy appRouter for now (has proper types)
    // TODO: Switch to createRouter(ctx) once handlers are migrated
    // The legacy setters above ensure appRouter works correctly
    const router = appRouter;

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
