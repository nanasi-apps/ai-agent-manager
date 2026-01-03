import type { AgentLogPayload, AgentStatePayload } from "@agent-manager/shared";
import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("electronAPI", {
	ping: () => ipcRenderer.invoke("ping"),
	getTheme: () => ipcRenderer.invoke("get-theme"),
	setThemeSource: (mode: "system" | "light" | "dark") =>
		ipcRenderer.invoke("dark-mode:set", mode),
	onThemeChanged: (callback: (isDark: boolean) => void) => {
		const listener = (_event: unknown, isDark: boolean) => callback(isDark);
		ipcRenderer.on("theme-changed", listener);
		return () => ipcRenderer.removeListener("theme-changed", listener);
	},
	onAgentLog: (callback: (payload: AgentLogPayload) => void) => {
		const listener = (_event: unknown, payload: AgentLogPayload) => callback(payload);
		ipcRenderer.on("agent-log", listener);
		return () => ipcRenderer.removeListener("agent-log", listener);
	},
	onAgentStateChanged: (callback: (payload: AgentStatePayload) => void) => {
		const listener = (_event: unknown, payload: AgentStatePayload) =>
			callback(payload);
		ipcRenderer.on("agent:state-changed", listener);
		return () => ipcRenderer.removeListener("agent:state-changed", listener);
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