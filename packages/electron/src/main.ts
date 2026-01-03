import {
	setAgentManager,
	setDevServerService,
	setGtrConfigService,
	setHandoverService,
	setNativeDialog,
	setStore,
	setWorktreeManager,
} from "@agent-manager/shared";
import { app, BrowserWindow, dialog } from "electron";
import path from "node:path";
import {
	setAgentManager as setElectronAgentManager,
	unifiedAgentManager,
} from "./agents";
import { setupAgentLogs } from "./main/agent-logs";
import { setupAgentState } from "./main/agent-state";
import { setupIpc } from "./main/ipc";
import { initializeWindowTheme, setupGlobalThemeHandlers } from "./main/theme";
import { worktreeManager } from "./main/worktree-manager";
import { devServerManager } from "./main/dev-server-manager";
import { startMcpServer } from "./server/mcp-server.js";
import { startOrpcServer } from "./server/orpc-server";
import { GtrConfigService } from "./services/gtr-config-service";
import * as handoverSummaryService from "./services/handover-summary-service";
import { store } from "./store";
import { fixProcessPath } from "./utils/path-enhancer";

// Call fixProcessPath BEFORE any other imports that might use git
fixProcessPath();

// Set up dependencies for the router
// Use unifiedAgentManager to support both CLI-based and API-based agents
setAgentManager(unifiedAgentManager);
setElectronAgentManager(unifiedAgentManager);
setStore(store);
setWorktreeManager(worktreeManager);
setHandoverService(handoverSummaryService);
setGtrConfigService(new GtrConfigService());
setDevServerService(devServerManager);
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

	const devUrl = `http://localhost:${process.env.WEB_PORT || 5173}`;
	if (app.isPackaged) {
		win.loadFile(path.join(__dirname, "renderer/index.html")).catch((err) => {
			console.error("Failed to load local file:", err);
		});
	} else {
		win.loadURL(devUrl).catch((err) => {
			console.error("Failed to load URL:", err);
		});
	}

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
	setupAgentState();

	// Start ORPC WebSocket server
	console.log("[Main] Starting ORPC WebSocket server...");
	startOrpcServer(Number(process.env.ORPC_PORT) || 3002);

	// Start internal MCP server
	console.log("[Main] Starting internal MCP server...");
	startMcpServer(Number(process.env.MCP_PORT) || 3001)
		.then(() => {
			console.log(`[Main] Internal MCP server started on port ${process.env.MCP_PORT || 3001}`);
		})
		.catch((err) => {
			console.error("[Main] Failed to start MCP server:", err);
		});
});

app.on("window-all-closed", () => {
	if (process.platform !== "darwin") {
		app.quit();
	}
});
