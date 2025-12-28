import {
	setAgentManager,
	setMcpManager,
	setNativeDialog,
	setOrchestrationManager,
	setStore,
	setWorktreeManager
} from "@agent-manager/shared";
import { app, BrowserWindow, dialog } from "electron";
import path from "path";
import { oneShotAgentManager, setAgentManager as setElectronAgentManager } from "./agents";
import { setupAgentLogs } from "./main/agent-logs";
import { setupIpc } from "./main/ipc";
import { loadMcpConfig } from "./main/mcp-config";
import { initializeWindowTheme, setupGlobalThemeHandlers } from "./main/theme";
import { store } from "./store";
import { mcpHub } from "./mcp-hub";
import { worktreeManager } from "./main/worktree-manager";
import { orchestrationManager } from "./main/orchestration-manager";
import { startMcpServer } from "./server/mcp-server.js";

// Set up dependencies for the router
setAgentManager(oneShotAgentManager);
setElectronAgentManager(oneShotAgentManager);
setStore(store);
setMcpManager(mcpHub);
setWorktreeManager(worktreeManager);
setOrchestrationManager(orchestrationManager);
orchestrationManager.initialize();
setNativeDialog({
	selectDirectory: async () => {
		const result = await dialog.showOpenDialog({
			properties: ["openDirectory"],
		});
		if (result.canceled) return null;
		return result.filePaths[0] ?? null;
	},
});

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

	// Initialize MCP Servers
	const mcpConfig = loadMcpConfig();
	for (const server of mcpConfig.servers) {
		mcpHub.connectToServer(server).catch((err) => {
			console.error(`[Main] Failed to connect to MCP server ${server.name}:`, err);
		});
	}

	createWindow();

	app.on("activate", () => {
		if (BrowserWindow.getAllWindows().length === 0) {
			createWindow();
		}
	});

	setupIpc();
	setupGlobalThemeHandlers();
	setupAgentLogs();

	// Start internal MCP server
	console.log("[Main] Starting internal MCP server...");
	startMcpServer(3001).then(() => {
		console.log("[Main] Internal MCP server started on port 3001");
	}).catch((err) => {
		console.error("[Main] Failed to start MCP server:", err);
	});
});

app.on("window-all-closed", () => {
	if (process.platform !== "darwin") {
		app.quit();
	}
});
