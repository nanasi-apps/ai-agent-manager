import { os } from "@orpc/server";
import { z } from "zod";
import { spawn } from "node:child_process";
import { readFile, writeFile, mkdir, readdir, unlink, stat } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import type { AgentConfig, AgentLogPayload, AgentType } from "./types/agent";
import type { IStore, Project } from "./types/store";
import { availableAgents, getAgentTemplate } from "./types/project";
import type { ModelTemplate } from "./types/project";
import type { IMcpManager } from "./types/mcp";
import type { IWorktreeManager } from "./types/worktree";

// Cross-platform UUID generation
function generateUUID(): string {
	// Use crypto.randomUUID if available (Node 19+, modern browsers)
	if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
		return crypto.randomUUID();
	}
	// Fallback for older environments
	return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
		const r = Math.random() * 16 | 0;
		const v = c === 'x' ? r : (r & 0x3 | 0x8);
		return v.toString(16);
	});
}

const MODEL_ID_SEPARATOR = "::";
const MODEL_CACHE_TTL_MS = 60_000;
const RULES_DIR = join(homedir(), '.agent-manager', 'rules');

// Hardcoded model lists for each CLI type
// Dynamic detection is unreliable due to authentication, permission dialogs, and CLI quirks
const HARDCODED_MODELS: Record<string, string[]> = {
	gemini: [
		'gemini-3-pro-preview',
		'gemini-3-flash-preview',
		'gemini-2.5-pro',
		'gemini-2.5-flash',
		'gemini-2.5-flash-lite',
	],
	claude: [
		'claude-sonnet-4.5',
		'claude-opus-4.5',
		'claude-haiku-4.5',
	],
	codex: [
		'gpt-5.2-codex',
		'gpt-5.1-codex-max',
		'gpt-5.1-codex-mini',
		'gpt-5.2',
	],
};

const modelListCache = new Map<string, { expiresAt: number; models: ModelTemplate[] }>();

function buildModelId(agentType: string, model?: string): string {
	return `${agentType}${MODEL_ID_SEPARATOR}${model ?? ''}`;
}

function parseModelId(modelId: string): { agentType: string; model?: string } | null {
	if (!modelId) return null;
	const [agentType, ...rest] = modelId.split(MODEL_ID_SEPARATOR);
	if (!agentType) return null;
	const model = rest.join(MODEL_ID_SEPARATOR);
	return { agentType, model: model || undefined };
}

function getModelsForCliType(cliType: string): string[] {
	return HARDCODED_MODELS[cliType] ?? [];
}



async function resolveProjectRules(projectId: string): Promise<string> {
	const storeInstance = getStoreOrThrow();
	const project = storeInstance.getProject(projectId);
	if (!project) return '';

	let globalRulesContent = '';
	if (project.activeGlobalRules && project.activeGlobalRules.length > 0) {
		for (const ruleId of project.activeGlobalRules) {
			try {
				const ruleContent = await readFile(join(RULES_DIR, ruleId), 'utf-8');
				globalRulesContent += `\n\n<!-- Rule: ${ruleId} -->\n${ruleContent}`;
			} catch (e) {
				console.warn(`Failed to read rule ${ruleId}`, e);
			}
		}
	}

	let projectRulesContent = '';
	if (project.projectRules && project.projectRules.length > 0) {
		for (const rule of project.projectRules) {
			projectRulesContent += `\n\n<!-- Project Rule: ${rule.name} -->\n${rule.content}`;
		}
	}

	return `${globalRulesContent}\n\n<!-- Project Specific Rules -->\n${projectRulesContent}`.trim();
}

/**
 * Interface for AgentManager - allows different implementations
 */
export interface IAgentManager {
	startSession(sessionId: string, command: string, config?: Partial<AgentConfig>): void;
	resetSession(sessionId: string, command: string, config?: Partial<AgentConfig>): void;
	stopSession(sessionId: string): boolean;
	sendToSession(sessionId: string, message: string): Promise<void>;
	isRunning(sessionId: string): boolean;
	listSessions(): string[];
	on(event: 'log', listener: (payload: AgentLogPayload) => void): void;
	getSessionMetadata(sessionId: string): { geminiSessionId?: string; codexThreadId?: string } | undefined;
	/** Store handover context to prepend to next user message */
	setPendingHandover(sessionId: string, context: string): void;
	/** Retrieve and clear pending handover context */
	consumePendingHandover(sessionId: string): string | undefined;
}

export interface INativeDialog {
	selectDirectory(): Promise<string | null>;
}

// Dependencies to be injected
let agentManager: IAgentManager | null = null;
let store: IStore | null = null;
let nativeDialog: INativeDialog | null = null;
let mcpManager: IMcpManager | null = null;
let worktreeManager: IWorktreeManager | null = null;

/**
 * Set the agent manager implementation
 */
export function setAgentManager(manager: IAgentManager): void {
	agentManager = manager;
	console.log('[Router] Agent manager set');
}

/**
 * Set the store implementation
 */
export function setStore(storeImpl: IStore): void {
	store = storeImpl;
	console.log('[Router] Store set');
}

export function setNativeDialog(dialogImpl: INativeDialog | null): void {
	nativeDialog = dialogImpl;
	console.log('[Router] Native dialog set');
}

export function setMcpManager(manager: IMcpManager): void {
	mcpManager = manager;
	console.log('[Router] MCP manager set');
}

export function setWorktreeManager(manager: IWorktreeManager): void {
	worktreeManager = manager;
	console.log('[Router] Worktree manager set');
}

function getAgentManagerOrThrow(): IAgentManager {
	if (!agentManager) {
		throw new Error('Agent manager not initialized. Call setAgentManager first.');
	}
	return agentManager;
}

function getStoreOrThrow(): IStore {
	if (!store) {
		throw new Error('Store not initialized. Call setStore first.');
	}
	return store;
}

function getNativeDialog(): INativeDialog | null {
	return nativeDialog;
}

function getMcpManagerOrThrow(): IMcpManager {
	if (!mcpManager) {
		throw new Error('MCP manager not initialized. Call setMcpManager first.');
	}
	return mcpManager;
}

function getWorktreeManagerOrThrow(): IWorktreeManager {
	if (!worktreeManager) {
		throw new Error('Worktree manager not initialized. Call setWorktreeManager first.');
	}
	return worktreeManager;
}

// Zod schema for agent type
const agentTypeSchema = z.string();

export const appRouter = os.router({
	ping: os
		.input(z.void())
		.output(z.string())
		.handler(async () => {
			console.log("Ping received on server");
			return "pong from electron (ORPC)";
		}),

	listGlobalRules: os
		.output(z.array(z.object({
			id: z.string(),
			name: z.string(),
			content: z.string().optional(),
		})))
		.handler(async () => {
			await mkdir(RULES_DIR, { recursive: true });
			try {
				const files = await readdir(RULES_DIR);
				const rules = [];
				for (const file of files) {
					if (file.endsWith('.md')) { // Only md files
						// id is filename, name is filename without ext for now
						// user might want custom names metadata, but let's stick to filename = name
						const filePath = join(RULES_DIR, file);
						const stats = await stat(filePath);
						if (stats.isFile()) {
							rules.push({
								id: file,
								name: file.replace(/\.md$/, ''),
							});
						}
					}
				}
				return rules;
			} catch (e) {
				return [];
			}
		}),

	getGlobalRule: os
		.input(z.object({ id: z.string() }))
		.output(z.object({
			id: z.string(),
			name: z.string(),
			content: z.string()
		}).nullable())
		.handler(async ({ input }) => {
			const filePath = join(RULES_DIR, input.id);
			try {
				const content = await readFile(filePath, 'utf-8');
				return {
					id: input.id,
					name: input.id.replace(/\.md$/, ''),
					content
				};
			} catch (e) {
				return null;
			}
		}),

	createGlobalRule: os
		.input(z.object({
			name: z.string().min(1),
			content: z.string().default('')
		}))
		.output(z.object({
			id: z.string(),
			success: z.boolean()
		}))
		.handler(async ({ input }) => {
			// Sanitize name to be safe filename
			const safeName = input.name.replace(/[^a-zA-Z0-9_-]/g, '_');
			const filename = `${safeName}.md`;
			const filePath = join(RULES_DIR, filename);
			await mkdir(RULES_DIR, { recursive: true });
			// Check if exists? Overwrite? Let's error if exists or append suffix?
			// Simple behavior: overwrite if same name
			await writeFile(filePath, input.content, 'utf-8');
			return { id: filename, success: true };
		}),

	updateGlobalRule: os
		.input(z.object({
			id: z.string(),
			content: z.string()
		}))
		.output(z.object({ success: z.boolean() }))
		.handler(async ({ input }) => {
			const filePath = join(RULES_DIR, input.id);
			await writeFile(filePath, input.content, 'utf-8');
			return { success: true };
		}),

	deleteGlobalRule: os
		.input(z.object({ id: z.string() }))
		.output(z.object({ success: z.boolean() }))
		.handler(async ({ input }) => {
			const filePath = join(RULES_DIR, input.id);
			try {
				await unlink(filePath);
				return { success: true };
			} catch (e) {
				return { success: false };
			}
		}),

	getPlatform: os
		.output(z.enum(["electron", "web"]))
		.handler(async () => "electron" as const),

	// List user created projects
	listProjects: os
		.output(z.array(z.object({
			id: z.string(),
			name: z.string(),
			description: z.string().optional(),
			rootPath: z.string().optional(),
			createdAt: z.number(),
			updatedAt: z.number(),
		})))
		.handler(async () => {
			return getStoreOrThrow().listProjects();
		}),

	// Create a new project
	createProject: os
		.input(z.object({
			name: z.string(),
			description: z.string().optional(),
			rootPath: z.string().min(1),
		}))
		.output(z.object({
			id: z.string(),
		}))
		.handler(async ({ input }) => {
			const id = generateUUID();
			const now = Date.now();
			getStoreOrThrow().addProject({
				id,
				name: input.name,
				description: input.description,
				rootPath: input.rootPath,
				createdAt: now,
				updatedAt: now,
			});
			return { id };
		}),

	// List available agent templates (Types)
	listAgentTemplates: os
		.output(z.array(z.object({
			id: z.string(),
			name: z.string(),
		})))
		.handler(async () => {
			return availableAgents.map(a => ({
				id: a.id,
				name: a.name,
			}));
		}),

	listModelTemplates: os
		.output(z.array(z.object({
			id: z.string(),
			name: z.string(),
			agentType: z.string(),
			agentName: z.string(),
			model: z.string().optional(),
		})))
		.handler(async () => {
			const cached = modelListCache.get('all');
			const now = Date.now();
			if (cached && cached.expiresAt > now) {
				return cached.models;
			}

			const results: ModelTemplate[] = [];

			for (const agent of availableAgents) {
				const agentType = agent.id;
				const agentName = agent.name;
				const cliType = agent.agent.type;
				const models = getModelsForCliType(cliType);

				// Only add default entry if there are no hardcoded models
				if (models.length === 0) {
					const defaultName = agentName.toLowerCase().includes('default')
						? agentName
						: `${agentName} (Default)`;
					results.push({
						id: buildModelId(agentType),
						name: defaultName,
						agentType,
						agentName,
					});
				} else {
					// Add all hardcoded models
					for (const model of models) {
						results.push({
							id: buildModelId(agentType, model),
							name: model,
							agentType,
							agentName,
							model,
						});
					}
				}
			}

			modelListCache.set('all', {
				expiresAt: now + MODEL_CACHE_TTL_MS,
				models: results,
			});

			return results;
		}),

	// Get a specific project
	getProject: os
		.input(z.object({ projectId: z.string() }))
		.output(z.object({
			id: z.string(),
			name: z.string(),
			description: z.string().optional(),
			rootPath: z.string().optional(),
			createdAt: z.number(),
			updatedAt: z.number(),
			activeGlobalRules: z.array(z.string()).optional(),
			projectRules: z.array(z.object({
				id: z.string(),
				name: z.string(),
				content: z.string()
			})).optional(),
		}).nullable())
		.handler(async ({ input }) => {
			const project = getStoreOrThrow().getProject(input.projectId);
			if (!project) return null;
			return {
				id: project.id,
				name: project.name,
				description: project.description,
				rootPath: project.rootPath,
				createdAt: project.createdAt,
				updatedAt: project.updatedAt,
				activeGlobalRules: project.activeGlobalRules,
				projectRules: project.projectRules,
			};
		}),

	updateProject: os
		.input(z.object({
			projectId: z.string(),
			name: z.string().min(1).optional(),
			rootPath: z.string().nullable().optional(),
			activeGlobalRules: z.array(z.string()).optional(),
			projectRules: z.array(z.object({
				id: z.string(),
				name: z.string(),
				content: z.string()
			})).optional(),
		}))
		.output(z.object({ success: z.boolean() }))
		.handler(async ({ input }) => {
			const storeInstance = getStoreOrThrow();
			const project = storeInstance.getProject(input.projectId);
			if (!project) return { success: false };

			const updates: Partial<Project> = {};
			if (input.name !== undefined) {
				updates.name = input.name;
			}
			if (Object.prototype.hasOwnProperty.call(input, 'rootPath')) {
				updates.rootPath = input.rootPath ?? undefined;
			}
			if (input.activeGlobalRules !== undefined) {
				updates.activeGlobalRules = input.activeGlobalRules;
			}
			if (input.projectRules !== undefined) {
				updates.projectRules = input.projectRules;
			}

			storeInstance.updateProject(input.projectId, updates);

			// Generate rule files in project root
			const updatedProject = storeInstance.getProject(input.projectId);
			if (updatedProject && updatedProject.rootPath) {
				try {
					let globalRulesContent = '';
					if (updatedProject.activeGlobalRules && updatedProject.activeGlobalRules.length > 0) {
						for (const ruleId of updatedProject.activeGlobalRules) {
							try {
								const ruleContent = await readFile(join(RULES_DIR, ruleId), 'utf-8');
								globalRulesContent += `\n\n<!-- Rule: ${ruleId} -->\n${ruleContent}`;
							} catch (e) {
								console.warn(`Failed to read rule ${ruleId}`, e);
							}
						}
					}

					let projectRulesContent = '';
					if (updatedProject.projectRules && updatedProject.projectRules.length > 0) {
						for (const rule of updatedProject.projectRules) {
							projectRulesContent += `\n\n<!-- Project Rule: ${rule.name} -->\n${rule.content}`;
						}
					}

					/*
					const finalContent = `${globalRulesContent}\n\n<!-- Project Specific Rules -->\n${projectRulesContent}`.trim();

					await writeFile(join(updatedProject.rootPath, 'Agents.md'), finalContent, 'utf-8');
					await writeFile(join(updatedProject.rootPath, 'Claude.md'), finalContent, 'utf-8');
					*/
				} catch (e) {
					console.error("Failed to generate rule files", e);
				}
			}

			return { success: true };
		}),

	selectDirectory: os
		.output(z.string().nullable())
		.handler(async () => {
			const dialog = getNativeDialog();
			if (!dialog) return null;
			return dialog.selectDirectory();
		}),

	startAgent: os
		.input(z.object({
			command: z.string(),
			sessionId: z.string().default('debug-session'),
			agentType: agentTypeSchema.optional(),
			agentModel: z.string().optional(),
			streamJson: z.boolean().optional(),
			cwd: z.string().optional(),
		}))
		.output(z.object({
			success: z.boolean(),
			message: z.string()
		}))
		.handler(async ({ input }) => {
			try {
				getAgentManagerOrThrow().startSession(input.sessionId, input.command, {
					type: (input.agentType as AgentType) || 'custom',
					command: input.command,
					model: input.agentModel,
					streamJson: input.streamJson,
					cwd: input.cwd,
				});
				return { success: true, message: "Agent started" };
			} catch (e) {
				const err = e as Error;
				return { success: false, message: err.message };
			}
		}),

	stopAgent: os
		.input(z.object({
			sessionId: z.string().default('debug-session')
		}))
		.output(z.object({
			success: z.boolean(),
			message: z.string()
		}))
		.handler(async ({ input }) => {
			getAgentManagerOrThrow().stopSession(input.sessionId);
			return { success: true, message: "Agent stopped" };
		}),

	// Check if an agent session is running
	isAgentRunning: os
		.input(z.object({ sessionId: z.string() }))
		.output(z.boolean())
		.handler(async ({ input }) => {
			return getAgentManagerOrThrow().isRunning(input.sessionId);
		}),

	// List all active sessions
	listActiveSessions: os
		.output(z.array(z.string()))
		.handler(async () => {
			return getAgentManagerOrThrow().listSessions();
		}),

	createConversation: os
		.input(z.object({
			projectId: z.string(),
			initialMessage: z.string(),
			modelId: z.string().optional(),
			agentType: z.string().optional(),
			agentModel: z.string().optional(),
		}))
		.output(z.object({
			sessionId: z.string(),
		}))
		.handler(async ({ input }) => {
			const sessionId = generateUUID();
			const now = Date.now();
			const storeInstance = getStoreOrThrow();
			const agentManagerInstance = getAgentManagerOrThrow();

			// Verify project exists
			const project = storeInstance.getProject(input.projectId);
			if (!project) {
				throw new Error(`Project not found: ${input.projectId}`);
			}

			const parsedModel = input.modelId ? parseModelId(input.modelId) : null;
			const resolvedAgentType = parsedModel?.agentType || input.agentType;

			if (!resolvedAgentType) {
				throw new Error('Model or agent type is required.');
			}

			// Get Agent Template
			const agentTemplate = getAgentTemplate(resolvedAgentType);
			if (!agentTemplate) {
				throw new Error(`Agent type not found: ${resolvedAgentType}`);
			}
			const resolvedModel = parsedModel?.model || input.agentModel;

			// Save to store with initialMessage and messages array
			storeInstance.addConversation({
				id: sessionId,
				projectId: input.projectId,
				title: input.initialMessage.slice(0, 30) || "New Conversation",
				initialMessage: input.initialMessage,
				createdAt: now,
				updatedAt: now,
				agentType: resolvedAgentType,
				agentModel: resolvedModel,
				messages: [{
					id: generateUUID(),
					role: 'user',
					content: input.initialMessage,
					timestamp: now,
				}]
			});

			if (!agentManagerInstance.isRunning(sessionId)) {
				console.log(`Starting agent for project ${input.projectId} (Session: ${sessionId})`);
				console.log(`Command: ${agentTemplate.agent.command}`);

				const rulesContent = await resolveProjectRules(input.projectId);

				agentManagerInstance.startSession(sessionId, agentTemplate.agent.command, {
					...agentTemplate.agent,
					model: resolvedModel,
					cwd: project.rootPath || agentTemplate.agent.cwd,
					rulesContent,
				});
			}

			agentManagerInstance.sendToSession(sessionId, input.initialMessage);

			return { sessionId };
		}),

	// Get a single conversation by ID
	getConversation: os
		.input(z.object({ sessionId: z.string() }))
		.output(z.object({
			id: z.string(),
			projectId: z.string(),
			title: z.string(),
			initialMessage: z.string(),
			createdAt: z.number(),
			updatedAt: z.number(),
			agentType: z.string().optional(),
			agentModel: z.string().optional(),
		}).nullable())
		.handler(async ({ input }) => {
			const conv = getStoreOrThrow().getConversation(input.sessionId);
			if (!conv) return null;
			return conv;
		}),

	// Update conversation title
	updateConversationTitle: os
		.input(z.object({
			sessionId: z.string(),
			title: z.string().min(1).max(120),
		}))
		.output(z.object({ success: z.boolean() }))
		.handler(async ({ input }) => {
			const storeInstance = getStoreOrThrow();
			const conv = storeInstance.getConversation(input.sessionId);
			if (!conv) return { success: false };
			storeInstance.updateConversation(input.sessionId, {
				title: input.title,
			});
			return { success: true };
		}),

	sendMessage: os
		.input(z.object({
			sessionId: z.string(),
			message: z.string(),
		}))
		.output(z.object({
			success: z.boolean(),
		}))
		.handler(async ({ input }) => {
			const storeInstance = getStoreOrThrow();
			const agentManagerInstance = getAgentManagerOrThrow();

			if (!agentManagerInstance.isRunning(input.sessionId)) {
				const conv = storeInstance.getConversation(input.sessionId);
				if (!conv) {
					return { success: false };
				}

				const agentTemplate = getAgentTemplate(conv.agentType || 'gemini');
				if (!agentTemplate) {
					console.error("Agent template not found for legacy/missing type");
					return { success: false };
				}

				const project = storeInstance.getProject(conv.projectId);
				const cwd = project?.rootPath || agentTemplate.agent.cwd;

				console.warn(`Session ${input.sessionId} not found, restarting with command: ${agentTemplate.agent.command}`);

				const rulesContent = await resolveProjectRules(conv.projectId);

				agentManagerInstance.startSession(input.sessionId, agentTemplate.agent.command, {
					...agentTemplate.agent,
					model: conv.agentModel,
					cwd,
					rulesContent,
				});
			}

			// Save the user message to store
			storeInstance.addMessage(input.sessionId, {
				id: generateUUID(),
				role: 'user',
				content: input.message,
				timestamp: Date.now(),
			});

			const pendingHandover = agentManagerInstance.consumePendingHandover(input.sessionId);
			const messageToSend = pendingHandover ? `${pendingHandover}\n${input.message}` : input.message;

			agentManagerInstance.sendToSession(input.sessionId, messageToSend);

			return { success: true };
		}),

	// Stop a running agent session
	stopSession: os
		.input(z.object({ sessionId: z.string() }))
		.output(z.object({ success: z.boolean() }))
		.handler(async ({ input }) => {
			const storeInstance = getStoreOrThrow();
			const success = getAgentManagerOrThrow().stopSession(input.sessionId);
			if (success) {
				storeInstance.addMessage(input.sessionId, {
					id: generateUUID(),
					role: 'system',
					content: 'Generation stopped by user.',
					timestamp: Date.now(),
					logType: 'system',
				});
			}
			return { success };
		}),

	// Get messages for a conversation
	getMessages: os
		.input(z.object({ sessionId: z.string() }))
		.output(z.array(z.object({
			id: z.string(),
			role: z.enum(['user', 'agent', 'system']),
			content: z.string(),
			timestamp: z.number(),
			logType: z.enum(['text', 'tool_call', 'tool_result', 'thinking', 'error', 'system']).optional(),
		})))
		.handler(async ({ input }) => {
			return getStoreOrThrow().getMessages(input.sessionId);
		}),

	// Add a message to a conversation (used for agent responses)
	addMessage: os
		.input(z.object({
			sessionId: z.string(),
			role: z.enum(['user', 'agent', 'system']),
			content: z.string(),
			logType: z.enum(['text', 'tool_call', 'tool_result', 'thinking', 'error', 'system']).optional(),
		}))
		.output(z.object({ success: z.boolean() }))
		.handler(async ({ input }) => {
			getStoreOrThrow().addMessage(input.sessionId, {
				id: generateUUID(),
				role: input.role,
				content: input.content,
				timestamp: Date.now(),
				logType: input.logType,
			});
			return { success: true };
		}),

	listConversations: os
		.input(z.object({
			projectId: z.string().optional()
		}))
		.output(z.array(z.object({
			id: z.string(),
			projectId: z.string(),
			title: z.string(),
			createdAt: z.number(),
			updatedAt: z.number(),
			agentType: z.string().optional(),
		})))
		.handler(async ({ input }) => {
			return getStoreOrThrow().listConversations(input.projectId);
		}),

	swapConversationAgent: os
		.input(z.object({
			sessionId: z.string(),
			modelId: z.string().optional(),
			agentType: z.string().optional(),
			agentModel: z.string().optional(),
		}))
		.output(z.object({
			success: z.boolean(),
			message: z.string().optional(),
		}))
		.handler(async ({ input }) => {
			const storeInstance = getStoreOrThrow();
			const agentManagerInstance = getAgentManagerOrThrow();

			const conv = storeInstance.getConversation(input.sessionId);
			if (!conv) {
				return { success: false, message: `Conversation not found: ${input.sessionId}` };
			}

			const parsedModel = input.modelId ? parseModelId(input.modelId) : null;
			const resolvedAgentType = parsedModel?.agentType || input.agentType;

			if (!resolvedAgentType) {
				return { success: false, message: 'Model or agent type is required.' };
			}

			const nextTemplate = getAgentTemplate(resolvedAgentType);
			if (!nextTemplate) {
				return { success: false, message: `Agent type not found: ${resolvedAgentType}` };
			}

			const currentTemplate = conv.agentType ? getAgentTemplate(conv.agentType) : undefined;
			const sameCli = currentTemplate?.agent.type === nextTemplate.agent.type;
			const resolvedModel = parsedModel?.model || input.agentModel;
			const nextModelLabel = resolvedModel;

			const project = storeInstance.getProject(conv.projectId);
			const cwd = project?.rootPath || nextTemplate.agent.cwd;

			const previousName = currentTemplate?.name || conv.agentType || 'unknown';
			const label = nextModelLabel || nextTemplate.name;
			const systemMessage = `Switched agent from ${previousName} to ${label}.`;

			storeInstance.updateConversation(input.sessionId, {
				agentType: resolvedAgentType,
				agentModel: resolvedModel,
			});

			storeInstance.addMessage(input.sessionId, {
				id: generateUUID(),
				role: 'system',
				content: systemMessage,
				timestamp: Date.now(),
				logType: 'system',
			});

			// Helper to get summary from an agent process
			async function getAgentSummary(agentType: string, context: string, metadata?: { geminiSessionId?: string; codexThreadId?: string }): Promise<string | null> {
				return new Promise((resolve) => {
					let command = '';
					let args: string[] = [];
					const prompt = 'Summarize the preceding conversation for a handover context. Focus on key decisions and current state.';

					// Determine command based on agent type
					if (agentType === 'codex' && metadata?.codexThreadId) {
						command = 'codex';
						// codex exec resume -m <model> <session_id> <prompt>
						args = ['exec', 'resume', '-m', 'gpt-5.2', metadata.codexThreadId, prompt];
					} else if (agentType === 'gemini' && metadata?.geminiSessionId) {
						command = 'gemini';
						// gemini --resume <id> "message"
						args = ['--resume', metadata.geminiSessionId, '-y', prompt];
					} else if (agentType === 'claude') {
						// Claude might support resume, but if we don't have ID, we fallback to context injection
						// For now, if no ID, fallback to context injection (std behavior below)
						command = 'claude';
						args = ['-p', prompt];
					} else {
						// Fallback: If we don't have an ID for resume, or it's a different agent,
						// we can try to feed the text context to a fresh instance (classic way),
						// BUT the user specifically asked to use 'resume' to avoid context dump issues.
						// So if we have IDs, we use them. If not, we might try the text injection as fallback.

						if (agentType === 'codex') {
							command = 'codex';
							args = ['exec', '-m', 'gpt-5.2', prompt];
						} else if (agentType === 'gemini') {
							command = 'gemini';
							args = ['-y', prompt];
						} else {
							return resolve(null);
						}
					}

					console.log(`[Router] Generating summary with: ${command} ${args.join(' ')}`);

					try {
						const child = spawn(command, args, {
							cwd,
							env: process.env,
							stdio: ['pipe', 'pipe', 'pipe'],
							shell: true,
						});

						// No timeout - let it run as long as needed
						// const timeout = setTimeout(...)

						let output = '';
						let stderrOutput = '';

						child.stderr.on('data', (data) => {
							stderrOutput += data.toString();
						});

						// Only write context if we are NOT resuming (fallback mode)
						const isResuming = args.includes('resume') || args.includes('--resume');
						if (!isResuming) {
							child.stdin.write(context);
						}
						child.stdin.end();

						child.stdout.on('data', (data) => {
							output += data.toString();
						});

						child.on('close', (code) => {
							// clearTimeout(timeout);
							if (code === 0 && output.trim()) {
								resolve(output.trim());
							} else {
								console.warn(`[Router] Summary generation failed/empty with code ${code}`);
								if (stderrOutput.trim()) {
									console.warn(`[Router] Summary stderr: ${stderrOutput.trim()}`);
								}
								if (output.trim()) {
									console.warn(`[Router] Summary stdout: ${output.trim().slice(0, 200)}`);
								}
								resolve(null);
							}
						});

						child.on('error', (err) => {
							console.error(`[Router] Summary generation error: ${err}`);
							// clearTimeout(timeout);
							resolve(null);
						});
					} catch (e) {
						console.error(`[Router] Summary generation exception: ${e}`);
						resolve(null);
					}
				});
			}

			function summarizeContent(content: string): string {
				const limit = 300;
				// Simple whitespace normalization
				const clean = content.replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
				if (clean.length <= limit) return clean;
				return clean.slice(0, limit) + '... (truncated)';
			}

			// Prepare context handover data BEFORE resetting the session
			// This preserves the old agent's session IDs for proper resume
			let handoverSummary: string | null = null;
			let handoverPreviousName = '';

			if (!sameCli) {
				const pastMessages = storeInstance.getMessages(input.sessionId);
				const recent = pastMessages
					.filter(m => (m.role === 'user' || m.role === 'agent') && (!m.logType || m.logType === 'text'))
					.slice(-20);

				if (recent.length > 0) {
					const historyText = recent.map(m => `${m.role === 'user' ? 'User' : 'Agent'}: ${m.content}`).join('\n\n');
					handoverPreviousName = currentTemplate?.name || conv.agentType || 'unknown';

					// Get metadata BEFORE resetSession clears it
					const metadata = agentManagerInstance.getSessionMetadata(input.sessionId);

					// Generate summary using the previous agent's context (if possible)
					handoverSummary = await getAgentSummary(conv.agentType || 'gemini', historyText, metadata);

					// Fallback to simple truncation if smart summary failed
					if (!handoverSummary) {
						handoverSummary = recent.map(m => {
							const role = m.role === 'user' ? 'User' : 'Agent';
							return `- ${role}: ${summarizeContent(m.content)}`;
						}).join('\n');
					}
				}
			}

			// NOW reset the session after we've captured the metadata
			agentManagerInstance.resetSession(input.sessionId, nextTemplate.agent.command, {
				...nextTemplate.agent,
				model: resolvedModel,
				cwd,
			});

			// Store handover context to prepend to next user message (if we have one)
			// This prevents the agent from responding with "I'm standing by..." type messages
			if (handoverSummary) {
				const handoverContext = `[SYSTEM CONTEXT from previous agent (${handoverPreviousName})]:
${handoverSummary}

[User's message follows]
`;
				agentManagerInstance.setPendingHandover(input.sessionId, handoverContext);
			}

			return { success: true, message: systemMessage };
		}),

	// MCP Management
	listMcpServers: os
		.output(z.array(z.object({
			name: z.string(),
			command: z.string(),
			args: z.array(z.string()),
			env: z.record(z.string(), z.string()).optional()
		})))
		.handler(async () => {
			return getMcpManagerOrThrow().getConnectedServers();
		}),

	addMcpServer: os
		.input(z.object({
			name: z.string(),
			command: z.string(),
			args: z.array(z.string()),
			env: z.record(z.string(), z.string()).optional()
		}))
		.output(z.object({ success: z.boolean() }))
		.handler(async ({ input }) => {
			await getMcpManagerOrThrow().connectToServer(input);
			return { success: true };
		}),

	removeMcpServer: os
		.input(z.object({ name: z.string() }))
		.output(z.object({ success: z.boolean() }))
		.handler(async ({ input }) => {
			await getMcpManagerOrThrow().disconnectServer(input.name);
			return { success: true };
		}),

	listMcpTools: os
		.output(z.array(z.object({
			name: z.string(),
			description: z.string().optional(),
			inputSchema: z.any().optional(),
			serverName: z.string()
		})))
		.handler(async () => {
			return getMcpManagerOrThrow().listTools();
		}),

	// Worktree Management
	listWorktrees: os
		.input(z.object({ projectId: z.string() }))
		.output(z.array(z.object({
			id: z.string(),
			path: z.string(),
			branch: z.string(),
			isMain: z.boolean(),
			isLocked: z.boolean(),
			prunable: z.string().nullable()
		})))
		.handler(async ({ input }) => {
			const project = getStoreOrThrow().getProject(input.projectId);
			if (!project || !project.rootPath) throw new Error('Project has no root path');
			return getWorktreeManagerOrThrow().getWorktrees(project.rootPath);
		}),

	createWorktree: os
		.input(z.object({
			projectId: z.string(),
			branch: z.string(),
			relativePath: z.string().optional()
		}))
		.output(z.object({
			success: z.boolean(),
			worktree: z.object({
				id: z.string(),
				path: z.string(),
				branch: z.string(),
				isMain: z.boolean(),
				isLocked: z.boolean(),
				prunable: z.string().nullable()
			}).optional()
		}))
		.handler(async ({ input }) => {
			const project = getStoreOrThrow().getProject(input.projectId);
			if (!project || !project.rootPath) throw new Error('Project has no root path');
			const wt = await getWorktreeManagerOrThrow().createWorktree(project.rootPath, input.branch, input.relativePath);
			return { success: true, worktree: wt };
		}),

	removeWorktree: os
		.input(z.object({
			projectId: z.string(),
			path: z.string(),
			force: z.boolean().optional()
		}))
		.output(z.object({ success: z.boolean() }))
		.handler(async ({ input }) => {
			const project = getStoreOrThrow().getProject(input.projectId);
			if (!project || !project.rootPath) throw new Error('Project has no root path');
			await getWorktreeManagerOrThrow().removeWorktree(project.rootPath, input.path, input.force);
			return { success: true };
		}),

	// Lock Management
	acquireLock: os
		.input(z.object({
			resourceId: z.string(),
			agentId: z.string(),
			intent: z.string(),
			ttlMs: z.number().optional()
		}))
		.output(z.boolean())
		.handler(async ({ input }) => {
			const expiresAt = input.ttlMs ? Date.now() + input.ttlMs : undefined;
			return getStoreOrThrow().acquireLock({
				resourceId: input.resourceId,
				agentId: input.agentId,
				intent: input.intent,
				timestamp: Date.now(),
				expiresAt
			});
		}),

	releaseLock: os
		.input(z.object({
			resourceId: z.string(),
			agentId: z.string()
		}))
		.output(z.boolean())
		.handler(async ({ input }) => {
			return getStoreOrThrow().releaseLock(input.resourceId, input.agentId);
		}),

	getLock: os
		.input(z.object({ resourceId: z.string() }))
		.output(z.object({
			resourceId: z.string(),
			agentId: z.string(),
			intent: z.string(),
			timestamp: z.number(),
			expiresAt: z.number().optional()
		}).optional())
		.handler(async ({ input }) => {
			return getStoreOrThrow().getLock(input.resourceId);
		}),

	listLocks: os
		.output(z.array(z.object({
			resourceId: z.string(),
			agentId: z.string(),
			intent: z.string(),
			timestamp: z.number(),
			expiresAt: z.number().optional()
		})))
		.handler(async () => {
			return getStoreOrThrow().listLocks();
		}),

	forceReleaseLock: os
		.input(z.object({ resourceId: z.string() }))
		.output(z.void())
		.handler(async ({ input }) => {
			getStoreOrThrow().forceReleaseLock(input.resourceId);
		})
});

export type AppRouter = typeof appRouter;
