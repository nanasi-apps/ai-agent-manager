import type { AgentStatePayload } from "@agent-manager/shared";

type AgentStatePortMessage = {
	type: "agent:state-changed";
	payload: AgentStatePayload;
};

let port: MessagePort | null = null;

const ensurePort = () => {
	if (typeof window === "undefined" || !window.electronAPI) {
		return null;
	}

	if (port) {
		return port;
	}

	const channel = new MessageChannel();
	window.postMessage("start-orpc-client", "*", [channel.port1]);
	channel.port2.start();
	port = channel.port2;
	return port;
};

export const onAgentStateChangedPort = (
	callback: (payload: AgentStatePayload) => void,
) => {
	const activePort = ensurePort();
	if (!activePort) return null;

	const handler = (event: MessageEvent<AgentStatePortMessage>) => {
		const data = event.data;
		if (data?.type === "agent:state-changed") {
			callback(data.payload);
		}
	};

	activePort.addEventListener("message", handler);

	return () => {
		activePort.removeEventListener("message", handler);
	};
};
