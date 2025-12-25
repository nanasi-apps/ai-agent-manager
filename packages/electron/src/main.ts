import { appRouter, setAgentManager, store } from "@agent-manager/shared";
import { RPCHandler } from "@orpc/server/message-port";
import { app, BrowserWindow, ipcMain, nativeTheme } from "electron";
import path from "path";
import { oneShotAgentManager } from "./oneshot-agent-manager";

// Use the one-shot agent manager for clean JSON output
// This spawns a new process per message using -p mode with --resume
setAgentManager(oneShotAgentManager);

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

	// Send initial theme
	win.webContents.on("did-finish-load", () => {
		win.webContents.send("theme-changed", nativeTheme.shouldUseDarkColors);
	});
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

	// Setup ORPC handler
	ipcMain.on("start-orpc-server", (event) => {
		const [serverPort] = event.ports;
		if (serverPort) {
			console.log("Main: Received ORPC port");
			const handler = new RPCHandler(appRouter);
			handler.upgrade(serverPort);
			serverPort.start();
		}
	});

	// Support theme updates
	nativeTheme.on("updated", () => {
		const isDark = nativeTheme.shouldUseDarkColors;
		BrowserWindow.getAllWindows().forEach((win) => {
			win.webContents.send("theme-changed", isDark);
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

	// Agent Log Setup - use one-shot agent manager
	oneShotAgentManager.on("log", (data) => {
		// Save agent message to store for persistence
		if (data.data) {
			store.addMessage(data.sessionId, {
				id: crypto.randomUUID(),
				role: data.type === 'system' ? 'system' : 'agent',
				content: data.data,
				timestamp: Date.now(),
				logType: data.type,
			});
		}

		BrowserWindow.getAllWindows().forEach((win) => {
			win.webContents.send("agent-log", data);
		});
	});
});

app.on("window-all-closed", () => {
	if (process.platform !== "darwin") {
		app.quit();
	}
});
