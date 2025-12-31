import { EventEmitter } from "node:events";
import type {
	AgentConfig,
	AgentLogPayload,
	AgentStatePayload,
} from "@agent-manager/shared";
import type { IAgentManager, WorktreeResumeRequest } from "./agent-manager";
import { oneShotAgentManager } from "./oneshot-agent-manager";

/**
 * Unified agent manager that wraps the CLI-based OneShot manager
 * All agents now use CLI tools with environment variables for API keys
 */
export class UnifiedAgentManager extends EventEmitter implements IAgentManager {
	constructor() {
		super();

		// Forward logs from the CLI manager
		oneShotAgentManager.on("log", (payload: AgentLogPayload) => {
			this.emit("log", payload);
		});
		oneShotAgentManager.on("state-changed", (payload: AgentStatePayload) => {
			this.emit("state-changed", payload);
		});
	}

	startSession(
		sessionId: string,
		command: string,
		config?: Partial<AgentConfig>,
	) {
		console.log(
			`[UnifiedAgentManager] Starting session ${sessionId} (type: ${config?.type ?? "custom"})`,
		);
		oneShotAgentManager.startSession(sessionId, command, config);
	}

	resetSession(
		sessionId: string,
		command: string,
		config?: Partial<AgentConfig>,
	) {
		oneShotAgentManager.resetSession(sessionId, command, config);
	}

	async sendToSession(sessionId: string, message: string) {
		await oneShotAgentManager.sendToSession(sessionId, message);
	}

	stopSession(sessionId: string): boolean {
		return oneShotAgentManager.stopSession(sessionId);
	}

	isProcessing(sessionId: string): boolean {
		return oneShotAgentManager.isProcessing(sessionId);
	}

	isRunning(sessionId: string): boolean {
		return oneShotAgentManager.isRunning(sessionId);
	}

	listSessions(): string[] {
		return oneShotAgentManager.listSessions();
	}

	getSessionMetadata(
		sessionId: string,
	): { geminiSessionId?: string; codexThreadId?: string } | undefined {
		return oneShotAgentManager.getSessionMetadata?.(sessionId);
	}

	setPendingHandover(sessionId: string, context: string) {
		oneShotAgentManager.setPendingHandover?.(sessionId, context);
	}

	consumePendingHandover(sessionId: string): string | undefined {
		return oneShotAgentManager.consumePendingHandover?.(sessionId);
	}

	getSessionCwd(sessionId: string): string | undefined {
		return oneShotAgentManager.getSessionCwd?.(sessionId);
	}

	requestWorktreeResume(
		sessionId: string,
		request: WorktreeResumeRequest,
	): boolean {
		return (
			oneShotAgentManager.requestWorktreeResume?.(sessionId, request) ?? false
		);
	}

	getSessionHomes(
		sessionId: string,
	): { geminiHome?: string; claudeHome?: string } | undefined {
		return oneShotAgentManager.getSessionHomes?.(sessionId);
	}

	getSessionConfig(sessionId: string): AgentConfig | undefined {
		return oneShotAgentManager.getSessionConfig(sessionId);
	}
}

export const unifiedAgentManager = new UnifiedAgentManager();
