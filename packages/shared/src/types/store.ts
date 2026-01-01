import type { AgentMode, ReasoningLevel } from "./agent";
import type { ApprovalRequest, ApprovalStatus } from "./approval";

/**
 * Chat message
 */
export interface Message {
	id: string;
	role: "user" | "agent" | "system";
	content: string;
	timestamp: number;
	logType?:
	| "text"
	| "tool_call"
	| "tool_result"
	| "thinking"
	| "error"
	| "system";
}

/**
 * Conversation session
 */
export interface Conversation {
	id: string;
	projectId: string;
	title: string;
	initialMessage: string;
	createdAt: number;
	updatedAt: number;
	geminiSessionName?: string;
	messages: Message[];
	agentType?: string;
	agentModel?: string;
	agentReasoning?: ReasoningLevel;
	agentMode?: AgentMode;
	/** Current working directory for the agent */
	cwd?: string;
	/** List of disabled MCP tools for this conversation */
	disabledMcpTools?: string[];
	/** Persisted agent session state (XState snapshot) */
	agentState?: unknown;
}

/**
 * Project entity
 */
export interface Project {
	id: string;
	name: string;
	description?: string;
	rootPath?: string;
	createdAt: number;
	updatedAt: number;
	activeGlobalRules?: string[];
	projectRules?: ProjectRule[];
}

export interface ProjectRule {
	id: string;
	name: string;
	content: string;
}

/**
 * Resource Lock
 * Used to coordinate access to files or logical resources between agents
 */
export interface ResourceLock {
	resourceId: string; // e.g., file path or logical identifier
	agentId: string; // e.g., conversation/session ID
	intent: string; // Description of what the agent is doing
	timestamp: number;
	expiresAt?: number; // Optional TTL
}

/**
 * API Settings for direct API calls (OpenAI, Gemini)
 * Stored separately from projects for security
 */
export interface ApiSettings {
	openaiApiKey?: string;
	openaiBaseUrl?: string;
	geminiApiKey?: string;
	geminiBaseUrl?: string;
	language?: string;
	notifyOnAgentComplete?: boolean;
	newConversionOpenMode?: "page" | "dialog";
}

/**
 * Interface for store implementations
 */
export interface IStore {
	// Data path
	setDataPath(dirPath: string): void;

	// Conversation methods
	addConversation(conversation: Conversation): void;
	getConversation(id: string): Conversation | undefined;
	listConversations(projectId?: string): Conversation[];
	updateConversation(id: string, updates: Partial<Conversation>): void;
	deleteConversation(id: string): void;

	// Message methods
	addMessage(conversationId: string, message: Message): void;
	getMessages(conversationId: string): Message[];

	// Project methods
	addProject(project: Project): void;
	getProject(id: string): Project | undefined;
	listProjects(): Project[];
	updateProject(id: string, updates: Partial<Project>): void;
	deleteProject(id: string): void;

	// Lock methods
	acquireLock(lock: ResourceLock): boolean;
	releaseLock(resourceId: string, agentId: string): boolean;
	getLock(resourceId: string): ResourceLock | undefined;
	listLocks(): ResourceLock[];
	forceReleaseLock(resourceId: string): void;

	// API settings methods
	getApiSettings(): ApiSettings;
	updateApiSettings(settings: Partial<ApiSettings>): void;

	// Approval methods
	addApproval(approval: ApprovalRequest): void;
	getApproval(id: string): ApprovalRequest | undefined;
	listApprovals(status?: ApprovalStatus): ApprovalRequest[];
	updateApproval(id: string, updates: Partial<ApprovalRequest>): void;
	deleteApproval(id: string): void;
}
