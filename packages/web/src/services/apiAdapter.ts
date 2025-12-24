import type { AgentConfig, IAgentManagerAPI } from "@agent-manager/shared";

// Electron実装（IPC通信）
class ElectronAdapter implements IAgentManagerAPI {
	async getPlatform(): Promise<"electron" | "web"> {
		return "electron";
	}

	async startAgent(config: AgentConfig): Promise<void> {
		console.log("[Electron] Starting agent via IPC:", config);
		// await window.electronAPI.invoke('startAgent', config);
	}

	async stopAgent(id: string): Promise<void> {
		console.log("[Electron] Stopping agent via IPC:", id);
	}
}

// Web実装（API通信 / Mock）
class WebAdapter implements IAgentManagerAPI {
	async getPlatform(): Promise<"electron" | "web"> {
		return "web";
	}

	async startAgent(config: AgentConfig): Promise<void> {
		console.log("[Web] Starting agent via HTTP:", config);
		// await fetch('/api/agents', { ... });
	}

	async stopAgent(id: string): Promise<void> {
		console.log("[Web] Stopping agent via HTTP:", id);
	}
}

// ファクトリ: 環境に応じて適切な実装を返す
export function createApiAdapter(): IAgentManagerAPI {
	if (window.electronAPI) {
		console.log("Detected Electron Environment");
		return new ElectronAdapter();
	} else {
		console.log("Detected Web Environment");
		return new WebAdapter();
	}
}

export const api = createApiAdapter();
