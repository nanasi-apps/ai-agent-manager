import type { AgentStatePayload } from "@agent-manager/shared";
import { BrowserWindow } from "electron";
import { unifiedAgentManager } from "../agents";
import { store } from "../store";
import { publishAgentState } from "./agent-state-port";

export function setupAgentState() {
	unifiedAgentManager.on(
		"state-changed",
		(payload: AgentStatePayload & { persistedState?: unknown }) => {
			const persistedState = payload.persistedState;
			const context = payload.context;
			const config = (context as { config?: { cwd?: unknown } })?.config;
			const cwd = typeof config?.cwd === "string" ? config.cwd : undefined;

			if (persistedState !== undefined) {
				store.updateConversation(payload.sessionId, {
					agentState: persistedState,
					...(cwd ? { cwd } : {}),
				});
			} else if (cwd) {
				store.updateConversation(payload.sessionId, { cwd });
			}

			const ipcPayload: AgentStatePayload = {
				sessionId: payload.sessionId,
				value: payload.value,
				context: payload.context,
			};

			publishAgentState(ipcPayload);

			BrowserWindow.getAllWindows().forEach((win) => {
				win.webContents.send("agent:state-changed", ipcPayload);
			});
		},
	);
}
