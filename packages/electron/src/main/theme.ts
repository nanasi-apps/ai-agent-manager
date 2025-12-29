import { BrowserWindow, ipcMain, nativeTheme } from "electron";

export function initializeWindowTheme(win: BrowserWindow) {
	// Send initial theme
	win.webContents.on("did-finish-load", () => {
		win.webContents.send("theme-changed", nativeTheme.shouldUseDarkColors);
	});
}

export function setupGlobalThemeHandlers() {
	// Support theme updates
	nativeTheme.on("updated", () => {
		const isDark = nativeTheme.shouldUseDarkColors;
		BrowserWindow.getAllWindows().forEach((w) => {
			w.webContents.send("theme-changed", isDark);
		});
	});

	ipcMain.handle("get-theme", () => {
		return nativeTheme.shouldUseDarkColors;
	});

	ipcMain.handle("dark-mode:set", (_, mode: "system" | "light" | "dark") => {
		if (["system", "light", "dark"].includes(mode)) {
			nativeTheme.themeSource = mode;
		}
		return nativeTheme.shouldUseDarkColors;
	});
}
