import type { AgentLogPayload, AgentStatePayload } from "@agent-manager/shared";

/**
 * Electron API exposed via preload script
 */
export interface ElectronAPI {
	ping: () => Promise<string>;
	getTheme: () => Promise<boolean>;
	setThemeSource: (mode: "system" | "light" | "dark") => Promise<boolean>;
	onThemeChanged: (callback: (isDark: boolean) => void) => void;
	onAgentLog: (callback: (payload: AgentLogPayload) => void) => void;
	onAgentStateChanged: (callback: (payload: AgentStatePayload) => void) => void;
}

declare global {
	interface ViewTransition {
		finished: Promise<void>;
		ready: Promise<void>;
		updateCallbackDone: Promise<void>;
		skipTransition: () => void;
	}

	interface Document {
		startViewTransition?: (
			updateCallback: () => void | Promise<void>,
		) => ViewTransition;
	}

	interface Window {
		electronAPI?: ElectronAPI;
	}
}
