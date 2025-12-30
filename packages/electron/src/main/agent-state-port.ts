import type { AgentStatePayload } from "@agent-manager/shared";
import type { MessagePortMain } from "electron";

type AgentStatePortMessage = {
	type: "agent:state-changed";
	payload: AgentStatePayload;
};

const ports = new Set<MessagePortMain>();
const lastStates = new Map<string, AgentStatePayload>();

function safePostMessage(port: MessagePortMain, message: AgentStatePortMessage) {
	try {
		port.postMessage(message);
	} catch (error) {
		console.warn("[AgentStatePort] Failed to post message, removing port", error);
		ports.delete(port);
	}
}

function sendInitialState(port: MessagePortMain) {
	for (const payload of lastStates.values()) {
		safePostMessage(port, { type: "agent:state-changed", payload });
	}
}

export function registerAgentStatePort(port: MessagePortMain) {
	if (ports.has(port)) return;
	ports.add(port);

	sendInitialState(port);
}

export function publishAgentState(payload: AgentStatePayload) {
	lastStates.set(payload.sessionId, payload);

	for (const port of ports) {
		safePostMessage(port, { type: "agent:state-changed", payload });
	}
}
