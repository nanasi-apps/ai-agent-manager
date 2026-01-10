/**
 * Session Utilities
 *
 * Helper functions for managing agent sessions.
 */

import type { SessionConfig } from "../ports/session-builder";

/**
 * Start an agent session using the provided configuration.
 * Consolidates the logic of calling agentManager.startSession with the expanded config.
 */
export function startAgentSession(
	agentManager: {
		startSession: (
			sessionId: string,
			command: string,
			options: Record<string, unknown>,
		) => void;
	},
	sessionId: string,
	config: SessionConfig,
): void {
	agentManager.startSession(sessionId, config.agentTemplate.agent.command, {
		...config.agentTemplate.agent,
		model: config.model,
		reasoning: config.reasoning,
		mode: config.mode,
		cwd: config.cwd,
		rulesContent: config.rulesContent,
		env: config.env,
		provider: config.provider,
	});
}
