import type {
	AgentLogPayload,
	AgentStatePayload,
	BranchNameRequest,
} from "@agent-manager/shared";
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
	getOrpcPort: () => Number(process.env.ORPC_PORT) || 3002,
	listBranchNameRequests: () => ipcRenderer.invoke("branch-name:list"),
	onBranchNameRequest: (callback: (payload: BranchNameRequest) => void) => {
		const listener = (_event: unknown, payload: BranchNameRequest) =>
			callback(payload);
		ipcRenderer.on("branch-name:request", listener);
		return () => ipcRenderer.removeListener("branch-name:request", listener);
	},
	onBranchNameOpen: (
		callback: (payload: { requestId: string }) => void,
	) => {
		const listener = (_event: unknown, payload: { requestId: string }) =>
			callback(payload);
		ipcRenderer.on("branch-name:open", listener);
		return () => ipcRenderer.removeListener("branch-name:open", listener);
	},
	onBranchNameResolved: (
		callback: (payload: { requestId: string; branchName?: string; cancelled?: boolean }) => void,
	) => {
		const listener = (
			_event: unknown,
			payload: { requestId: string; branchName?: string; cancelled?: boolean },
		) => callback(payload);
		ipcRenderer.on("branch-name:resolved", listener);
		return () => ipcRenderer.removeListener("branch-name:resolved", listener);
	},
	submitBranchName: (requestId: string, branchName: string) =>
		ipcRenderer.invoke("branch-name:submit", { requestId, branchName }),
	generateBranchName: (requestId: string) =>
		ipcRenderer.invoke("branch-name:generate", { requestId }),
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
