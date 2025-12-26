import type { AgentLogPayload } from '@agent-manager/shared';

/**
 * Electron API exposed via preload script
 */
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

export { };
