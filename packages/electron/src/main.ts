import { setAgentManager, setStore } from "@agent-manager/shared";
import { app, BrowserWindow } from "electron";
import path from "path";
import { oneShotAgentManager } from "./agents";
import { setupAgentLogs } from "./main/agent-logs";
import { setupIpc } from "./main/ipc";
import { initializeWindowTheme, setupGlobalThemeHandlers } from "./main/theme";
import { store } from "./store";

// Set up dependencies for the router
setAgentManager(oneShotAgentManager);
setStore(store);

function createWindow() {
	const win = new BrowserWindow({
		width: 1200,
		height: 800,
		webPreferences: {
			preload: path.join(__dirname, "preload.js"),
			nodeIntegration: false,
			contextIsolation: true,
		},
	});

	const devUrl = "http://localhost:5173";
	win.loadURL(devUrl).catch((err) => {
		console.error("Failed to load URL:", err);
	});

	win.webContents.openDevTools();

	initializeWindowTheme(win);
}

app.whenReady().then(() => {
	// Initialize the persistent store with Electron's userData path
	const userDataPath = app.getPath("userData");
	store.setDataPath(userDataPath);
	console.log(`[Main] Store initialized with path: ${userDataPath}`);

	createWindow();

	app.on("activate", () => {
		if (BrowserWindow.getAllWindows().length === 0) {
			createWindow();
		}
	});

	setupIpc();
	setupGlobalThemeHandlers();
	setupAgentLogs();
});

app.on("window-all-closed", () => {
	if (process.platform !== "darwin") {
		app.quit();
	}
});
