export interface ElectronAPI {
	ping: () => Promise<string>;
	getTheme: () => Promise<boolean>;
	setThemeSource: (mode: "system" | "light" | "dark") => Promise<boolean>;
	onThemeChanged: (callback: (isDark: boolean) => void) => void;
}

declare global {
	interface Window {
		electronAPI?: ElectronAPI;
	}
}
