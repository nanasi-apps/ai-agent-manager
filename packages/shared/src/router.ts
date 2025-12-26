import { os } from "@orpc/server";
import { z } from "zod";
import type { AgentConfig, AgentLogPayload } from "./types/agent";
import type { IStore } from "./types/store";
import { availableAgents, getAgentTemplate } from "./types/project";
import type { AgentType } from "./types/agent";

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

/**
 * Interface for AgentManager - allows different implementations
 */
export interface IAgentManager {
	startSession(sessionId: string, command: string, config?: Partial<AgentConfig>): void;
	stopSession(sessionId: string): boolean;
	sendToSession(sessionId: string, message: string): void;
	isRunning(sessionId: string): boolean;
	listSessions(): string[];
	on(event: 'log', listener: (payload: AgentLogPayload) => void): void;
}

// Dependencies to be injected
let agentManager: IAgentManager | null = null;
let store: IStore | null = null;

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

	getPlatform: os
		.output(z.enum(["electron", "web"]))
		.handler(async () => "electron" as const),

	// List user created projects
	listProjects: os
		.output(z.array(z.object({
			id: z.string(),
			name: z.string(),
			description: z.string().optional(),
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

	// Get a specific project
	getProject: os
		.input(z.object({ projectId: z.string() }))
		.output(z.object({
			id: z.string(),
			name: z.string(),
			description: z.string().optional(),
			createdAt: z.number(),
		}).nullable())
		.handler(async ({ input }) => {
			const project = getStoreOrThrow().getProject(input.projectId);
			if (!project) return null;
			return {
				id: project.id,
				name: project.name,
				description: project.description,
				createdAt: project.createdAt,
			};
		}),

	startAgent: os
		.input(z.object({
			command: z.string(),
			sessionId: z.string().default('debug-session'),
			agentType: agentTypeSchema.optional(),
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
			agentType: z.string(),
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

			// Get Agent Template
			const agentTemplate = getAgentTemplate(input.agentType);
			if (!agentTemplate) {
				throw new Error(`Agent type not found: ${input.agentType}`);
			}

			// Save to store with initialMessage and messages array
			storeInstance.addConversation({
				id: sessionId,
				projectId: input.projectId,
				title: input.initialMessage.slice(0, 30) || "New Conversation",
				initialMessage: input.initialMessage,
				createdAt: now,
				updatedAt: now,
				agentType: input.agentType,
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
				agentManagerInstance.startSession(sessionId, agentTemplate.agent.command, agentTemplate.agent);
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

				console.warn(`Session ${input.sessionId} not found, restarting with command: ${agentTemplate.agent.command}`);
				agentManagerInstance.startSession(input.sessionId, agentTemplate.agent.command, agentTemplate.agent);
			}

			// Save the user message to store
			storeInstance.addMessage(input.sessionId, {
				id: generateUUID(),
				role: 'user',
				content: input.message,
				timestamp: Date.now(),
			});

			agentManagerInstance.sendToSession(input.sessionId, input.message);

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
		})
});

export type AppRouter = typeof appRouter;
