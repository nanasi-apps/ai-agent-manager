import { os } from "@orpc/server";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { agentManager } from "./agent-manager";
import { availableAgents, getAgentTemplate, type AgentType } from "./projects";
import { store } from "./store";

// Zod schema for agent type
const agentTypeSchema = z.string(); // Simplify to string to allow extensibility

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
			return store.listProjects();
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
			const id = randomUUID();
			const now = Date.now();
			store.addProject({
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
			const project = store.getProject(input.projectId);
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
				agentManager.startSession(input.sessionId, input.command, {
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
			agentManager.stopSession(input.sessionId);
			return { success: true, message: "Agent stopped" };
		}),

	// Check if an agent session is running
	isAgentRunning: os
		.input(z.object({ sessionId: z.string() }))
		.output(z.boolean())
		.handler(async ({ input }) => {
			return agentManager.isRunning(input.sessionId);
		}),

	// List all active sessions
	listActiveSessions: os
		.output(z.array(z.string()))
		.handler(async () => {
			return agentManager.listSessions();
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
			const sessionId = randomUUID();
			const now = Date.now();

			// Verify project exists
			const project = store.getProject(input.projectId);
			if (!project) {
				throw new Error(`Project not found: ${input.projectId}`);
			}

			// Get Agent Template
			const agentTemplate = getAgentTemplate(input.agentType);
			if (!agentTemplate) {
				throw new Error(`Agent type not found: ${input.agentType}`);
			}

			// Save to store with initialMessage and messages array
			store.addConversation({
				id: sessionId,
				projectId: input.projectId,
				title: input.initialMessage.slice(0, 30) || "New Conversation",
				initialMessage: input.initialMessage,
				createdAt: now,
				updatedAt: now,
				agentType: input.agentType,
				messages: [{
					id: randomUUID(),
					role: 'user',
					content: input.initialMessage,
					timestamp: now,
				}]
			});

			if (!agentManager.isRunning(sessionId)) {
				console.log(`Starting agent for project ${input.projectId} (Session: ${sessionId})`);
				console.log(`Command: ${agentTemplate.agent.command}`);
				agentManager.startSession(sessionId, agentTemplate.agent.command, agentTemplate.agent);
			}

			agentManager.sendToSession(sessionId, input.initialMessage);

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
			const conv = store.getConversation(input.sessionId);
			if (!conv) return null;
			return conv;
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
			if (!agentManager.isRunning(input.sessionId)) {
				// If we have the conversation in store, we know which project it belongs to
				const conv = store.getConversation(input.sessionId);
				if (!conv) {
					return { success: false };
				}

				const agentTemplate = getAgentTemplate(conv.agentType || 'gemini'); // Default fallback
				if (!agentTemplate) {
					console.error("Agent template not found for legacy/missing type");
					return { success: false };
				}

				console.warn(`Session ${input.sessionId} not found, restarting with command: ${agentTemplate.agent.command}`);
				agentManager.startSession(input.sessionId, agentTemplate.agent.command, agentTemplate.agent);
			}

			// Save the user message to store
			store.addMessage(input.sessionId, {
				id: randomUUID(),
				role: 'user',
				content: input.message,
				timestamp: Date.now(),
			});

			agentManager.sendToSession(input.sessionId, input.message);

			return { success: true };
		}),

	// Stop a running agent session
	stopSession: os
		.input(z.object({ sessionId: z.string() }))
		.output(z.object({ success: z.boolean() }))
		.handler(async ({ input }) => {
			const success = agentManager.stopSession(input.sessionId);
			if (success) {
				store.addMessage(input.sessionId, {
					id: randomUUID(),
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
			return store.getMessages(input.sessionId);
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
			store.addMessage(input.sessionId, {
				id: randomUUID(),
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
			return store.listConversations(input.projectId);
		})
});

export type AppRouter = typeof appRouter;
