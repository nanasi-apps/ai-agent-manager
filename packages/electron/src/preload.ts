import type { AgentLogPayload, AgentStatePayload } from "@agent-manager/shared";
import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("electronAPI", {
	ping: () => ipcRenderer.invoke("ping"),
	getTheme: () => ipcRenderer.invoke("get-theme"),
	setThemeSource: (mode: "system" | "light" | "dark") =>
		ipcRenderer.invoke("dark-mode:set", mode),
	onThemeChanged: (callback: (isDark: boolean) => void) => {
		ipcRenderer.on("theme-changed", (_event, isDark) => callback(isDark));
	},
	onAgentLog: (callback: (payload: AgentLogPayload) => void) => {
		ipcRenderer.on("agent-log", (_event, payload) => callback(payload));
	},
	onAgentStateChanged: (callback: (payload: AgentStatePayload) => void) => {
		ipcRenderer.on("agent:state-changed", (_event, payload) =>
			callback(payload),
		);
	},
});

window.addEventListener("message", (event) => {
	if (event.data === "start-orpc-client") {
		console.log(
			"Preload: Received start-orpc-client message, forwarding to Main...",
		);
		const [serverPort] = event.ports;
		ipcRenderer.postMessage("start-orpc-server", null, [serverPort]);
	}
});
