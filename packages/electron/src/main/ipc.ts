import { ipcMain } from "electron";
import { registerAgentStatePort } from "./agent-state-port";

export function setupIpc() {
	// NOTE: ORPC handler is registered in setupElectronOrpc() (orpc-server.ts)
	// Do NOT register it here to avoid duplicate request processing.

	// Setup Agent State port (separate from ORPC)
	ipcMain.on("start-agent-state", (event) => {
		const [statePort] = event.ports;
		if (statePort) {
			console.log("Main: Received Agent State port");
			registerAgentStatePort(statePort);
			statePort.start();
		}
	});
}
