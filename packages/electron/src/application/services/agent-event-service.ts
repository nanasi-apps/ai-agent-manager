import type {
	AgentStatePayload,
	IAgentEventService,
	SessionEvent,
} from "@agent-manager/shared";
import { unifiedAgentManager } from "../sessions/unified-agent-manager";

export class AgentEventServiceAdapter implements IAgentEventService {
	subscribeEvents(
		callback: (event: SessionEvent) => void,
		sessionId?: string,
	): () => void {
		const handler = (event: SessionEvent) => {
			if (sessionId && event.sessionId !== sessionId) return;
			callback(event);
		};

		unifiedAgentManager.on("session-event", handler);
		return () => {
			unifiedAgentManager.off("session-event", handler);
		};
	}

	subscribeState(
		callback: (payload: AgentStatePayload) => void,
		sessionId?: string,
	): () => void {
		const handler = (payload: AgentStatePayload) => {
			if (sessionId && payload.sessionId !== sessionId) return;
			callback(payload);
		};

		unifiedAgentManager.on("state-changed", handler);
		return () => {
			unifiedAgentManager.off("state-changed", handler);
		};
	}
}
