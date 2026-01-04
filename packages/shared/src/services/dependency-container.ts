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
	): {
		geminiSessionId?: string;
		codexSessionId?: string;
		codexThreadId?: string;
	} | undefined;
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
	/** Get the current session config */
	getSessionConfig?(sessionId: string): Partial<AgentConfig> | undefined;
}

export interface INativeDialog {
	selectDirectory(): Promise<string | null>;
	selectPaths(options: {
		type: "file" | "dir" | "any";
		multiple?: boolean;
	}): Promise<string[]>;
}

// ... types
import type { SummaryOptions } from "../types/agent";
import type { GtrConfig } from "../types/gtr-config";

// ... previous interfaces ...

export interface IHandoverService {
	generateAgentSummary(options: SummaryOptions): Promise<string | null>;
}

export interface IGtrConfigService {
	getGtrConfig(rootPath: string): Promise<GtrConfig>;
	updateGtrConfig(rootPath: string, config: GtrConfig): Promise<void>;
}

// Dependencies to be injected
let agentManager: IAgentManager | null = null;
let store: IStore | null = null;
let nativeDialog: INativeDialog | null = null;
let worktreeManager: IWorktreeManager | null = null;
let handoverService: IHandoverService | null = null;
let gtrConfigService: IGtrConfigService | null = null;

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

export function setHandoverService(service: IHandoverService): void {
	handoverService = service;
	console.log("[DependencyContainer] Handover service set");
}

export function setGtrConfigService(service: IGtrConfigService): void {
	gtrConfigService = service;
	console.log("[DependencyContainer] GtrConfig service set");
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

export function getHandoverServiceOrThrow(): IHandoverService {
	if (!handoverService) {
		throw new Error(
			"Handover service not initialized. Call setHandoverService first.",
		);
	}
	return handoverService;
}

export function getGtrConfigServiceOrThrow(): IGtrConfigService {
	if (!gtrConfigService) {
		throw new Error(
			"GtrConfig service not initialized. Call setGtrConfigService first.",
		);
	}
	return gtrConfigService;
}

export interface IRunningProcess {
	pid: number;
	command: string;
	projectId: string;
	ports: Record<string, number>;
	startedAt: number;
	type: "web" | "process" | "other";
	url?: string;
	conversationId?: string;
	logs: string[];
	status: 'running' | 'stopped' | 'error';
	exitCode?: number | null;
}

export interface IDevServerService {
	getRunningProject(
		projectId: string,
		conversationId?: string,
	): IRunningProcess | undefined;
	listRunningProjects(): IRunningProcess[];
	stopProject(projectId: string, conversationId?: string): Promise<boolean>;
	launchProject(
		projectId: string,
		options?: { timeout?: number; cwd?: string; conversationId?: string; configName?: string },
	): Promise<IRunningProcess>;
	getProjectLogs(projectId: string, conversationId?: string): string[];
}

let devServerService: IDevServerService | null = null;

export function setDevServerService(service: IDevServerService): void {
	devServerService = service;
	console.log("[DependencyContainer] DevServer service set");
}

export function getDevServerServiceOrThrow(): IDevServerService {
	if (!devServerService) {
		throw new Error(
			"DevServer service not initialized. Call setDevServerService first.",
		);
	}
	return devServerService;
}
