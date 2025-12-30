import { execSync } from "node:child_process";
import {
	setAgentManager,
	setNativeDialog,
	setStore,
	setWorktreeManager,
} from "@agent-manager/shared";
import { app, BrowserWindow, dialog } from "electron";
import { homedir } from "os";
import path from "path";
import {
	setAgentManager as setElectronAgentManager,
	unifiedAgentManager,
} from "./agents";
import { setupAgentLogs } from "./main/agent-logs";
import { setupAgentState } from "./main/agent-state";
import { setupIpc } from "./main/ipc";
import { initializeWindowTheme, setupGlobalThemeHandlers } from "./main/theme";
import { worktreeManager } from "./main/worktree-manager";
import { startMcpServer } from "./server/mcp-server.js";
import { startOrpcServer } from "./server/orpc-server";
import { store } from "./store";

// Fix PATH for macOS GUI apps (Electron doesn't inherit shell PATH)
// This ensures git and other CLI tools are found
const fixPath = () => {
	if (process.platform !== "darwin") return;

	try {
		// Get the PATH from the user's default shell
		const shell = process.env.SHELL || "/bin/zsh";
		const shellPath = execSync(`${shell} -ilc 'echo $PATH'`, {
			encoding: "utf-8",
			timeout: 5000,
		}).trim();

		if (shellPath && shellPath !== process.env.PATH) {
			process.env.PATH = shellPath;
			console.log("[Main] Fixed PATH from shell");
		}
	} catch (error) {
		console.warn("[Main] Failed to get PATH from shell:", error);
	}

	// Fallback: ensure common bin paths are included
	const ensurePathIncludes = (binPath: string) => {
		const delimiter = ":";
		if (!process.env.PATH?.includes(binPath)) {
			process.env.PATH = `${binPath}${delimiter}${process.env.PATH}`;
			console.log(`[Main] Added ${binPath} to PATH`);
		}
	};

	const home = homedir();
	ensurePathIncludes(path.join(home, ".local", "bin"));
	ensurePathIncludes("/opt/homebrew/bin"); // Apple Silicon
	ensurePathIncludes("/usr/local/bin"); // Intel Mac
};

// Call fixPath BEFORE any other imports that might use git
fixPath();

// Set up dependencies for the router
// Use unifiedAgentManager to support both CLI-based and API-based agents
setAgentManager(unifiedAgentManager);
setElectronAgentManager(unifiedAgentManager);
setStore(store);
setWorktreeManager(worktreeManager);
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
	startOrpcServer(3002);

	// Start internal MCP server
	console.log("[Main] Starting internal MCP server...");
	startMcpServer(3001)
		.then(() => {
			console.log("[Main] Internal MCP server started on port 3001");
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
