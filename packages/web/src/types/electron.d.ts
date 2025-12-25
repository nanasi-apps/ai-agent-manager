export interface AgentLogPayload {
	sessionId: string;
	data: string;
	type?: 'text' | 'tool_call' | 'tool_result' | 'thinking' | 'error' | 'system';
	raw?: unknown;
}

export interface ElectronAPI {
	ping: () => Promise<string>;
	getTheme: () => Promise<boolean>;
	setThemeSource: (mode: "system" | "light" | "dark") => Promise<boolean>;
	onThemeChanged: (callback: (isDark: boolean) => void) => void;
	onAgentLog: (callback: (payload: AgentLogPayload) => void) => void;
}

declare global {
	interface Window {
		electronAPI?: ElectronAPI;
	}
}
