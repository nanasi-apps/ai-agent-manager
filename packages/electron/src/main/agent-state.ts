import type { AgentStatePayload, AgentStateValue } from "@agent-manager/shared";
import { BrowserWindow, Notification } from "electron";
import { unifiedAgentManager } from "../agents";
import { store } from "../store/file-store";
import { publishAgentState } from "./agent-state-port";

const lastStateBySession = new Map<string, AgentStateValue>();

function matchesState(value: AgentStateValue | undefined, state: string): boolean {
	if (!value) return false;
	if (typeof value === "string") return value === state;
	return Object.prototype.hasOwnProperty.call(value, state);
}

function shouldNotifyOnComplete(
	currentValue: AgentStateValue,
	previousValue: AgentStateValue | undefined,
	context: Record<string, unknown>,
): boolean {
	const transitionedToIdle =
		matchesState(previousValue, "processing") && matchesState(currentValue, "idle");
	if (!transitionedToIdle) return false;
	if ((context as { pendingWorktreeResume?: unknown })?.pendingWorktreeResume) {
		return false;
	}
	const notifyEnabled = store.getAppSettings().notifyOnAgentComplete ?? true;

	return notifyEnabled && Notification.isSupported();
}

function sendCompletionNotification(sessionId: string) {
	const conversation = store.getConversation(sessionId);
	const project = conversation?.projectId
		? store.getProject(conversation.projectId)
		: undefined;

	const title = "Agent completed";
	const bodyParts: string[] = [];
	if (conversation?.title) bodyParts.push(conversation.title);
	if (project?.name) bodyParts.push(project.name);
	const body = bodyParts.length > 0 ? bodyParts.join(" • ") : sessionId;
	console.log(`[AgentState] Sending completion notification for ${sessionId}: ${body}`);
	new Notification({ title, body, silent: false, }).show();
}

export function setupAgentState() {
	unifiedAgentManager.on(
		"state-changed",
		(payload: AgentStatePayload & { persistedState?: unknown }) => {
			const persistedState = payload.persistedState;
			const context = payload.context;
			const config = (context as { config?: { cwd?: unknown } })?.config;
			const cwd = typeof config?.cwd === "string" ? config.cwd : undefined;
			const previousValue = lastStateBySession.get(payload.sessionId);
			lastStateBySession.set(payload.sessionId, payload.value);

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

			if (shouldNotifyOnComplete(payload.value, previousValue, payload.context)) {
				console.log(`[AgentState] Sending completion notification for ${payload.sessionId}`);
				sendCompletionNotification(payload.sessionId);
			}

			publishAgentState(ipcPayload);

			BrowserWindow.getAllWindows().forEach((win) => {
				win.webContents.send("agent:state-changed", ipcPayload);
			});
		},
	);
}
