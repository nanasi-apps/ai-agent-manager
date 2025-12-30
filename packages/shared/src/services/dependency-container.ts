import type {
	AgentConfig,
	AgentLogPayload,
	AgentStatePayload,
} from "../types/agent";
import type { IStore } from "../types/store";
import type { IWorktreeManager } from "../types/worktree";

/**
 * Interface for AgentManager - allows different implementations
 */
export interface IAgentManager {
	startSession(
		sessionId: string,
		command: string,
		config?: Partial<AgentConfig>,
	): void;
	resetSession(
		sessionId: string,
		command: string,
		config?: Partial<AgentConfig>,
	): void;
	stopSession(sessionId: string): boolean;
	sendToSession(sessionId: string, message: string): Promise<void>;
	isRunning(sessionId: string): boolean;
	isProcessing?(sessionId: string): boolean;
	listSessions(): string[];
	on(event: "log", listener: (payload: AgentLogPayload) => void): void;
	on(
		event: "state-changed",
		listener: (payload: AgentStatePayload) => void,
	): void;
	getSessionMetadata(
		sessionId: string,
	): { geminiSessionId?: string; codexThreadId?: string } | undefined;
	/** Store handover context to prepend to next user message */
	setPendingHandover(sessionId: string, context: string): void;
	/** Retrieve and clear pending handover context */
	consumePendingHandover(sessionId: string): string | undefined;
	/** Schedule a resume in a git worktree after the current turn completes. */
	requestWorktreeResume?(
		sessionId: string,
		request: {
			cwd: string;
			branch: string;
			repoPath: string;
			resumeMessage?: string;
		},
	): boolean;
	/** Get the current working directory for a session */
	getSessionCwd?(sessionId: string): string | undefined;
	/** Get the temp home directories for a session (for MCP config inspection) */
	getSessionHomes?(
		sessionId: string,
	): { geminiHome?: string; claudeHome?: string } | undefined;
}

export interface INativeDialog {
	selectDirectory(): Promise<string | null>;
}

// Dependencies to be injected
let agentManager: IAgentManager | null = null;
let store: IStore | null = null;
let nativeDialog: INativeDialog | null = null;
let worktreeManager: IWorktreeManager | null = null;

/**
 * Set the agent manager implementation
 */
export function setAgentManager(manager: IAgentManager): void {
	agentManager = manager;
	console.log("[DependencyContainer] Agent manager set");
}

/**
 * Set the store implementation
 */
export function setStore(storeImpl: IStore): void {
	store = storeImpl;
	console.log("[DependencyContainer] Store set");
}

export function setNativeDialog(dialogImpl: INativeDialog | null): void {
	nativeDialog = dialogImpl;
	console.log("[DependencyContainer] Native dialog set");
}

export function setWorktreeManager(manager: IWorktreeManager): void {
	worktreeManager = manager;
	console.log("[DependencyContainer] Worktree manager set");
}

export function getAgentManagerOrThrow(): IAgentManager {
	if (!agentManager) {
		throw new Error(
			"Agent manager not initialized. Call setAgentManager first.",
		);
	}
	return agentManager;
}

export function getStoreOrThrow(): IStore {
	if (!store) {
		throw new Error("Store not initialized. Call setStore first.");
	}
	return store;
}

export function getNativeDialog(): INativeDialog | null {
	return nativeDialog;
}

export function getWorktreeManagerOrThrow(): IWorktreeManager {
	if (!worktreeManager) {
		throw new Error(
			"Worktree manager not initialized. Call setWorktreeManager first.",
		);
	}
	return worktreeManager;
}
