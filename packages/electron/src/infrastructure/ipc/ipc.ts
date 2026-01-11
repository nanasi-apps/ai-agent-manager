import { ipcMain } from "electron";

export function setupIpc() {
	// NOTE: ORPC handler is registered in setupElectronOrpc() (orpc-server.ts)
	// Do NOT register it here to avoid duplicate request processing.
}
