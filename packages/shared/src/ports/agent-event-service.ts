/**
 * Agent Event Service Port - Interface for agent event streaming
 *
 * This port defines the contract for agent event subscriptions.
 * Implementation lives in the electron package.
 */

import type { SessionEvent } from "../contracts/events";
import type { AgentStatePayload } from "../types/agent";

/**
 * Interface for agent event streaming service
 */
export interface IAgentEventService {
	/**
	 * Subscribe to session events for all sessions or a specific session
	 * @param sessionId - Optional session ID to filter events
	 * @returns Unsubscribe function
	 */
	subscribeEvents(
		callback: (event: SessionEvent) => void,
		sessionId?: string,
	): () => void;

	/**
	 * Subscribe to agent state changes
	 * @param sessionId - Optional session ID to filter events
	 * @returns Unsubscribe function
	 */
	subscribeState(
		callback: (payload: AgentStatePayload) => void,
		sessionId?: string,
	): () => void;
}
