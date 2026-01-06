import type {
	AgentConfig,
	AgentLogPayload,
	AgentStatePayload,
	IAgentManager,
} from "@agent-manager/shared";

// Re-export IAgentManager from shared for backward compatibility
export type { IAgentManager } from "@agent-manager/shared";

/**
 * Extended proxy interface for convenient access to agent manager methods
 */
export interface AgentManagerProxy extends IAgentManager {
	instance(): IAgentManager;
}

/**
 * Request to resume an agent session in a git worktree
 */
export interface WorktreeResumeRequest {
	cwd: string;
	branch: string;
	repoPath: string;
	resumeMessage?: string;
}

// Current active agent manager instance
let activeAgentManager: IAgentManager | null = null;

/**
 * Set the active agent manager implementation
 */
export function setAgentManager(manager: IAgentManager): void {
	activeAgentManager = manager;
	console.log("[AgentManager] Implementation set");
}

/**
 * Get the current agent manager instance
 * Throws if no manager has been set
 */
export function getAgentManager(): IAgentManager {
	if (!activeAgentManager) {
		throw new Error(
			"Agent manager not initialized. Call setAgentManager first.",
		);
	}
	return activeAgentManager;
}

function on(event: "log", listener: (payload: AgentLogPayload) => void): void;
function on(
	event: "state-changed",
	listener: (payload: AgentStatePayload) => void,
): void;
function on(
	event: "log" | "state-changed",
	listener:
		| ((payload: AgentLogPayload) => void)
		| ((payload: AgentStatePayload) => void),
): void {
	if (event === "log") {
		getAgentManager().on("log", listener as (payload: AgentLogPayload) => void);
		return;
	}
	getAgentManager().on(
		"state-changed",
		listener as (payload: AgentStatePayload) => void,
	);
}

/**
 * Proxy object for convenient access to agent manager methods
 */
export const agentManager: AgentManagerProxy = {
	instance(): IAgentManager {
		return getAgentManager();
	},
	startSession(
		sessionId: string,
		command: string,
		config?: Partial<AgentConfig>,
	) {
		return getAgentManager().startSession(sessionId, command, config);
	},
	resetSession(
		sessionId: string,
		command: string,
		config?: Partial<AgentConfig>,
	) {
		return getAgentManager().resetSession(sessionId, command, config);
	},
	stopSession(sessionId: string) {
		return getAgentManager().stopSession(sessionId);
	},
	async sendToSession(sessionId: string, message: string) {
		return getAgentManager().sendToSession(sessionId, message);
	},
	isRunning(sessionId: string) {
		return getAgentManager().isRunning(sessionId);
	},
	isProcessing(sessionId: string) {
		return getAgentManager().isProcessing?.(sessionId) ?? false;
	},
	listSessions() {
		return getAgentManager().listSessions();
	},
	on,
	getSessionMetadata(sessionId: string) {
		return getAgentManager().getSessionMetadata(sessionId);
	},
	setPendingHandover(sessionId: string, context: string) {
		return getAgentManager().setPendingHandover(sessionId, context);
	},
	consumePendingHandover(sessionId: string) {
		return getAgentManager().consumePendingHandover(sessionId);
	},
	requestWorktreeResume(sessionId: string, request: WorktreeResumeRequest) {
		return (
			getAgentManager().requestWorktreeResume?.(sessionId, request) ?? false
		);
	},
	getSessionCwd(sessionId: string): string | undefined {
		return getAgentManager().getSessionCwd?.(sessionId);
	},
	getSessionHomes(sessionId: string) {
		return getAgentManager().getSessionHomes?.(sessionId);
	},
	getSessionConfig(sessionId: string) {
		return getAgentManager().getSessionConfig?.(sessionId);
	},
};
