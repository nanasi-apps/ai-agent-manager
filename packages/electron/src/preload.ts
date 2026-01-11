import { contextBridge, ipcRenderer } from "electron";

console.log("[Preload] Script starting...");

// Expose minimal API to signal Electron environment for oRPC client detection
contextBridge.exposeInMainWorld("electronAPI", {
	isElectron: true,
});

window.addEventListener("message", (event) => {
	if (event.data === "start-orpc-client") {
		console.log(
			"Preload: Received start-orpc-client message, forwarding to Main...",
		);
		const [serverPort] = event.ports;
		ipcRenderer.postMessage("start-orpc-server", null, [serverPort]);
	} else if (event.data === "start-agent-state") {
		// Legacy: Keep for transition until client is fully updated
		console.log(
			"Preload: Received start-agent-state message, forwarding to Main...",
		);
		const [statePort] = event.ports;
		ipcRenderer.postMessage("start-agent-state", null, [statePort]);
	}
});
