import type { AgentConfig } from "@agent-manager/shared";

/**
 * Legacy API Adapter interface
 * This is kept for compatibility but prefer using ORPC directly
 */
interface IApiAdapter {
	getPlatform(): Promise<"electron" | "web">;
	startAgent(config: AgentConfig): Promise<void>;
	stopAgent(id: string): Promise<void>;
}

// Electron implementation (IPC communication)
class ElectronAdapter implements IApiAdapter {
	async getPlatform(): Promise<"electron" | "web"> {
		return "electron";
	}

	async startAgent(config: AgentConfig): Promise<void> {
		console.log("[Electron] Starting agent via IPC:", config);
	}

	async stopAgent(id: string): Promise<void> {
		console.log("[Electron] Stopping agent via IPC:", id);
	}
}

// Web implementation (API communication / Mock)
class WebAdapter implements IApiAdapter {
	async getPlatform(): Promise<"electron" | "web"> {
		return "web";
	}

	async startAgent(config: AgentConfig): Promise<void> {
		console.log("[Web] Starting agent via HTTP:", config);
	}

	async stopAgent(id: string): Promise<void> {
		console.log("[Web] Stopping agent via HTTP:", id);
	}
}

// Factory: Return appropriate implementation based on environment
export function createApiAdapter(): IApiAdapter {
	if (window.electronAPI) {
		console.log("Detected Electron Environment");
		return new ElectronAdapter();
	} else {
		console.log("Detected Web Environment");
		return new WebAdapter();
	}
}

export const api = createApiAdapter();
