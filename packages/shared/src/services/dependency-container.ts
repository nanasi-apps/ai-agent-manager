/**
 * @deprecated This entire file is deprecated and will be removed once migration to RouterContext is complete.
 * All interfaces have been moved to shared/src/ports.
 * Global getters/setters are replaced by passing 'ctx' around.
 */

import type { IAgentManager } from "../ports/agent-manager";
import type { IDevServerService } from "../ports/dev-server-service";
import type { IGtrConfigService } from "../ports/gtr-config-service";
import type { IHandoverService } from "../ports/handover-service";
import type { INativeDialog } from "../ports/native-dialog";
import type { IStore } from "../ports/store";
import type {
	IWebServerService,
	IWebServerStatus,
} from "../ports/web-server-service";
import type { IWorktreeManager } from "../ports/worktree-manager";

// Re-export interfaces for backward compatibility during migration
export type {
	IAgentManager,
	IDevServerService,
	IGtrConfigService,
	IHandoverService,
	INativeDialog,
	IStore,
	IWebServerService,
	IWebServerStatus,
	IWorktreeManager,
};

// ============================================================================
// GLOBAL STATE (Legacy)
// ============================================================================

let agentManager: IAgentManager | null = null;
let store: IStore | null = null;
let nativeDialog: INativeDialog | null = null;
let worktreeManager: IWorktreeManager | null = null;
let handoverService: IHandoverService | null = null;
let gtrConfigService: IGtrConfigService | null = null;
let devServerService: IDevServerService | null = null;
let webServerService: IWebServerService | null = null;

// ============================================================================
// SETTERS (Used by bootstrap)
// ============================================================================

export function setAgentManager(manager: IAgentManager): void {
	agentManager = manager;
	// Console logs removed to reduce noise
}

export function setStore(storeImpl: IStore): void {
	store = storeImpl;
}

export function setNativeDialog(dialogImpl: INativeDialog | null): void {
	nativeDialog = dialogImpl;
}

export function setWorktreeManager(manager: IWorktreeManager): void {
	worktreeManager = manager;
}

export function setHandoverService(service: IHandoverService): void {
	handoverService = service;
}

export function setGtrConfigService(service: IGtrConfigService): void {
	gtrConfigService = service;
}

export function setDevServerService(service: IDevServerService): void {
	devServerService = service;
}

export function setWebServerService(service: IWebServerService): void {
	webServerService = service;
}

// ============================================================================
// GETTERS (Legacy - replace with RouterContext usage)
// ============================================================================

/** @deprecated Use ctx.agentManager */
export function getAgentManagerOrThrow(): IAgentManager {
	if (!agentManager) {
		throw new Error(
			"Agent manager not initialized. Call setAgentManager first.",
		);
	}
	return agentManager;
}

/** @deprecated Use ctx.store */
export function getStoreOrThrow(): IStore {
	if (!store) {
		throw new Error("Store not initialized. Call setStore first.");
	}
	return store;
}

/** @deprecated Use ctx.nativeDialog */
export function getNativeDialog(): INativeDialog | null {
	return nativeDialog;
}

/** @deprecated Use ctx.worktreeManager */
export function getWorktreeManagerOrThrow(): IWorktreeManager {
	if (!worktreeManager) {
		throw new Error(
			"Worktree manager not initialized. Call setWorktreeManager first.",
		);
	}
	return worktreeManager;
}

/** @deprecated Use ctx.handoverService */
export function getHandoverServiceOrThrow(): IHandoverService {
	if (!handoverService) {
		throw new Error(
			"Handover service not initialized. Call setHandoverService first.",
		);
	}
	return handoverService;
}

/** @deprecated Use ctx.gtrConfigService */
export function getGtrConfigServiceOrThrow(): IGtrConfigService {
	if (!gtrConfigService) {
		throw new Error(
			"GtrConfig service not initialized. Call setGtrConfigService first.",
		);
	}
	return gtrConfigService;
}

/** @deprecated Use ctx.devServerService */
export function getDevServerServiceOrThrow(): IDevServerService {
	if (!devServerService) {
		throw new Error(
			"DevServer service not initialized. Call setDevServerService first.",
		);
	}
	return devServerService;
}

/** @deprecated Use ctx.webServerService */
export function getWebServerServiceOrThrow(): IWebServerService {
	if (!webServerService) {
		throw new Error(
			"WebServer service not initialized. Call setWebServerService first.",
		);
	}
	return webServerService;
}
