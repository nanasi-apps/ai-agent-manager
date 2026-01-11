/**
 * Electron Main Process Entry Point
 *
 * This file initializes the Electron application and wires up all services.
 *
 * Architecture (Milestone 3):
 * - Bootstrap module creates RouterContext and router via factory
 * - oRPC adapter connects the router to Electron IPC
 * - Legacy global DI is still set up for transition period
 */

import path from "node:path";
import { type AppRouter, getLogger, initLogger } from "@agent-manager/shared";
import { app, BrowserWindow, shell } from "electron";
// Import new adapter layer
import { setupElectronOrpc } from "./adapters/orpc";
// Import bootstrap first (sets up all dependencies)
import { bootstrap, getStore } from "./app/bootstrap";
import { setupAgentState } from "./application/services/agent-state";
import {
	initializeWindowTheme,
	setupGlobalThemeHandlers,
} from "./infrastructure/desktop/theme";
import { devServerManager } from "./infrastructure/dev-server/dev-server-manager";
import { setupIpc } from "./infrastructure/ipc/ipc";
// Main process modules
import { setupAgentLogs } from "./infrastructure/logging/agent-logs";
// Infrastructure
import { startMcpServer } from "./infrastructure/mcp/mcp-server.js";
import { setupBranchNameChannels } from "./services/branch-name-channels";
import { webServerManager } from "./services/web-server-manager";
import { fixProcessPath } from "./utils/path-enhancer";

// Call fixProcessPath BEFORE any other imports that might use git
fixProcessPath();
initLogger();

const logger = getLogger(["electron", "main"]);

// Bootstrap the application - creates RouterContext and router
// This replaces the scattered setAgentManager/setStore calls
const { router } = bootstrap();

// Wire the router to services that need it
// Cast is safe - createRouter() returns a compatible router structure
webServerManager.setRouter(router as AppRouter);

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
			logger.error("Failed to load local file: {err}", { err });
		});
	} else {
		win.loadURL(devUrl).catch((err) => {
			logger.error("Failed to load URL: {err}", { err });
		});
	}

	win.webContents.openDevTools();

	initializeWindowTheme(win);
}

app.whenReady().then(async () => {
	// Initialize the persistent store with Electron's userData path
	const store = getStore();
	const userDataPath = app.getPath("userData");
	store.setDataPath(userDataPath);
	logger.info("Store initialized with path: {userDataPath}", { userDataPath });

	createWindow();

	app.on("activate", () => {
		if (BrowserWindow.getAllWindows().length === 0) {
			createWindow();
		}
	});

	setupIpc();
	setupBranchNameChannels();
	setupGlobalThemeHandlers();
	setupAgentLogs();
	setupAgentState();

	// Start ORPC handlers using the new adapter (passes router explicitly)
	// This sets up MessagePort communication for Electron renderer process
	logger.info("Setting up ORPC Electron handlers...");
	setupElectronOrpc(router as AppRouter);

	// Start optional Web Server (Hono + ORPC)
	const appSettings = store.getAppSettings();
	const autoStartWebServer = appSettings.webServerAutoStart ?? false;
	const autoOpenBrowser = appSettings.webServerAutoOpenBrowser ?? false;
	const envPort = process.env.WEB_SERVER_PORT;
	const envHost = process.env.WEB_SERVER_HOST;
	const shouldStartWebServer = Boolean(envPort) || autoStartWebServer;
	if (shouldStartWebServer) {
		const requestedPort = envPort ? Number(envPort) : appSettings.webServerPort;
		const port = Number.isNaN(requestedPort) ? undefined : requestedPort;
		const host = envHost || appSettings.webServerHost || "0.0.0.0";
		logger.info("Starting Web Server on {host}:{port}...", {
			host,
			port: port ?? "random",
		});
		try {
			const status = await webServerManager.start({ port, host });
			if (autoStartWebServer && autoOpenBrowser && status.localUrl) {
				try {
					await shell.openExternal(status.localUrl);
				} catch (err) {
					logger.warn("Failed to open browser for Web Server: {err}", {
						err,
					});
				}
			}
		} catch (err) {
			logger.error("Failed to start Web Server: {err}", { err });
		}
	}

	// Start internal MCP server
	logger.info("Starting internal MCP server...");
	startMcpServer(Number(process.env.MCP_PORT) || 3001, store)
		.then(() => {
			logger.info("Internal MCP server started on port {port}", {
				port: process.env.MCP_PORT || 3001,
			});
		})
		.catch((err) => {
			logger.error("Failed to start MCP server: {err}", { err });
		});
});

app.on("window-all-closed", () => {
	if (process.platform !== "darwin") {
		app.quit();
	}
});

app.on("before-quit", async (_event) => {
	// Stop dev servers
	const running = devServerManager.listRunningProjects();
	if (running.length > 0) {
		logger.info("Stopping {count} dev servers before quit...", {
			count: running.length,
		});
		await devServerManager.stopAll();
	}

	// Stop Web Server
	await webServerManager.stop();
});
