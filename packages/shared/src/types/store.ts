import type { AgentMode, ReasoningLevel } from "./agent";
import type {
	ApprovalChannel,
	ApprovalRequest,
	ApprovalStatus,
} from "./approval";

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
	| "system"
	| "plan";
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
	agentProvider?: string;
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
import type { AgentConfigJson } from "./launch-config";

// ...

export interface Project {
	id: string;
	name: string;
	description?: string;
	rootPath?: string;
	createdAt: number;
	updatedAt: number;
	/** List of disabled global rule IDs. If undefined/empty, all global rules are enabled. */
	disabledGlobalRules?: string[];
	projectRules?: ProjectRule[];
	// Use the new structured config
	autoConfig?: AgentConfigJson;
	/**
	 * Multiple launch configurations
	 * This allows users to have different run profiles (e.g. Run, Debug, Tests)
	 */
	launchConfigs?: AgentConfigJson[];
}

export interface ProjectRule {
	id: string;
	name: string;
	content: string;
}

/**
 * Re-export AgentConfigJson as AutoConfig for backward compatibility in imports
 * (or simply remove AutoConfig interface and let users import from launch-config)
 */
export type AutoConfig = AgentConfigJson;

export interface GlobalRule {
	id: string;
	name: string;
	content?: string;
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
export interface AppSettings {
	language?: string;
	notifyOnAgentComplete?: boolean;
	approvalNotificationChannels?: ApprovalChannel[];
	newConversionOpenMode?: "page" | "dialog";
	webServerAutoStart?: boolean;
	webServerAutoOpenBrowser?: boolean;
	webServerHost?: string;
	webServerPort?: number;
	slackWebhookUrl?: string;
	discordWebhookUrl?: string;
}

export interface ModelProviderBase {
	id: string;
	name: string;
	disabledModels?: string[];
}

export interface ModelProviderSimple extends ModelProviderBase {
	type: "gemini";
	baseUrl?: string;
	apiKey?: string;
}

export interface ModelProviderCodex extends ModelProviderBase {
	type: "codex" | "openai" | "openai_compatible";
	baseUrl?: string;
	envKey?: string;
	apiKey?: string;
}

export type ModelProvider = ModelProviderSimple | ModelProviderCodex;

export interface ApiSettings {
	providers: ModelProvider[];
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

	// App settings methods
	getAppSettings(): AppSettings;
	updateAppSettings(settings: Partial<AppSettings>): void;

	// Approval methods
	addApproval(approval: ApprovalRequest): void;
	getApproval(id: string): ApprovalRequest | undefined;
	listApprovals(status?: ApprovalStatus): ApprovalRequest[];
	updateApproval(id: string, updates: Partial<ApprovalRequest>): void;
	deleteApproval(id: string): void;
}
