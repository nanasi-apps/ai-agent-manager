import { appRouter } from "@agent-manager/shared";
import { RPCHandler } from "@orpc/server/message-port";
import { app, BrowserWindow, ipcMain, nativeTheme } from "electron";
import path from "path";

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
	createWindow();

	app.on("activate", () => {
		if (BrowserWindow.getAllWindows().length === 0) {
			createWindow();
		}
	});

	// Setup ORPC handler
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
});

app.on("window-all-closed", () => {
	if (process.platform !== "darwin") {
		app.quit();
	}
});
