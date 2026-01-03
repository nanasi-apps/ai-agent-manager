import { os } from "@orpc/server";
import { z } from "zod";
import {
	getAgentManagerOrThrow,
	getHandoverServiceOrThrow,
	getStoreOrThrow,
} from "../services/dependency-container";
import { parseModelId } from "../services/model-fetcher";
import { resolveProjectRules } from "../services/rules-resolver";
import {
	buildSessionConfig,
	startAgentSession,
} from "../services/session-builder";
import { buildHandoverContext } from "../templates/handover-templates";
import { getModePrompt } from "../templates/mode-prompts";
import type { AgentMode, ReasoningLevel } from "../types/agent";
import { getAgentTemplate } from "../types/project";
import { generateUUID } from "../utils";

const reasoningLevelSchema = z.enum(["low", "middle", "high", "extraHigh"]);
const agentModeSchema = z.enum(["regular", "plan", "ask"]);
const DEFAULT_REASONING_LEVEL: ReasoningLevel = "middle";
const DEFAULT_AGENT_MODE: AgentMode = "regular";
const HANDOVER_SUMMARY_TIMEOUT_MS = 10000;

function shouldUseReasoning(agentCliType: string, model?: string): boolean {
	if (agentCliType !== "codex") return false;
	if (!model) return true;
	return model.toLowerCase().startsWith("gpt");
}

function resolveReasoning(
	agentCliType: string,
	model?: string,
	reasoning?: ReasoningLevel,
): ReasoningLevel | undefined {
	if (!shouldUseReasoning(agentCliType, model)) return undefined;
	return reasoning ?? DEFAULT_REASONING_LEVEL;
}

function formatReasoningLabel(level?: ReasoningLevel): string {
	if (!level) return "Default";
	switch (level) {
		case "extraHigh":
			return "Extra High";
		case "middle":
			return "Middle";
		case "high":
			return "High";
		case "low":
			return "Low";
		default:
			return "Default";
	}
}

// Helper function to truncate content
function summarizeContent(content: string): string {
	const limit = 300;
	const clean = content
		.replace(/[\r\n]+/g, " ")
		.replace(/\s+/g, " ")
		.trim();
	if (clean.length <= limit) return clean;
	return clean.slice(0, limit) + "... (truncated)";
}

function buildFallbackSummary(
	messages: Array<{ role: string; content: string }>,
): string {
	if (messages.length === 0) {
		return "- No recent user or agent messages to summarize.";
	}
	return messages
		.map((m) => {
			const role = m.role === "user" ? "User" : "Agent";
			return `- ${role}: ${summarizeContent(m.content)}`;
		})
		.join("\n");
}

export const conversationsRouter = {
	createConversation: os
		.input(
			z.object({
				projectId: z.string(),
				initialMessage: z.string(),
				modelId: z.string().optional(),
				agentType: z.string().optional(),
				agentModel: z.string().optional(),
				reasoning: reasoningLevelSchema.optional(),
				mode: agentModeSchema.optional(),
			}),
		)
		.output(
			z.object({
				sessionId: z.string(),
			}),
		)
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
				throw new Error("Model or agent type is required.");
			}

			const resolvedModel = parsedModel?.model || input.agentModel;
			const resolvedReasoning = resolveReasoning(
				resolvedAgentType,
				resolvedModel,
				input.reasoning,
			);
			const resolvedMode = input.mode ?? DEFAULT_AGENT_MODE;

			// Build session config using the shared utility
			const sessionConfig = await buildSessionConfig({
				projectId: input.projectId,
				agentType: resolvedAgentType,
				model: resolvedModel,
				mode: resolvedMode,
				reasoning: resolvedReasoning,
			});

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
				agentReasoning: resolvedReasoning,
				agentMode: resolvedMode,
				cwd: sessionConfig.cwd,
				messages: [
					{
						id: generateUUID(),
						role: "user",
						content: input.initialMessage,
						timestamp: now,
					},
				],
			});

			if (!agentManagerInstance.isRunning(sessionId)) {
				console.log(
					`Starting agent for project ${input.projectId} (Session: ${sessionId})`,
				);
				console.log(`Command: ${sessionConfig.agentTemplate.agent.command}`);

				startAgentSession(agentManagerInstance, sessionId, sessionConfig);
			}

			await agentManagerInstance.sendToSession(sessionId, input.initialMessage);

			return { sessionId };
		}),

	getConversation: os
		.input(z.object({ sessionId: z.string() }))
		.output(
			z
				.object({
					id: z.string(),
					projectId: z.string(),
					title: z.string(),
					initialMessage: z.string(),
					createdAt: z.number(),
					updatedAt: z.number(),
					agentType: z.string().optional(),
					agentModel: z.string().optional(),
					agentReasoning: reasoningLevelSchema.optional(),
					agentMode: agentModeSchema.optional(),
					cwd: z.string().optional(),
					disabledMcpTools: z.array(z.string()).optional(),
				})
				.nullable(),
		)
		.handler(async ({ input }) => {
			const conv = getStoreOrThrow().getConversation(input.sessionId);
			if (!conv) return null;
			return conv;
		}),

	updateConversationTitle: os
		.input(
			z.object({
				sessionId: z.string(),
				title: z.string().min(1).max(120),
			}),
		)
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
		.input(
			z.object({
				sessionId: z.string(),
				message: z.string(),
			}),
		)
		.output(
			z.object({
				success: z.boolean(),
			}),
		)
		.handler(async ({ input }) => {
			const storeInstance = getStoreOrThrow();
			const agentManagerInstance = getAgentManagerOrThrow();

			if (!agentManagerInstance.isRunning(input.sessionId)) {
				const conv = storeInstance.getConversation(input.sessionId);
				if (!conv) {
					return { success: false };
				}

				const resolvedReasoning = resolveReasoning(
					conv.agentType || "gemini",
					conv.agentModel,
					conv.agentReasoning,
				);
				if (!conv.agentReasoning && resolvedReasoning) {
					storeInstance.updateConversation(input.sessionId, {
						agentReasoning: resolvedReasoning,
					});
				}

				// Build session config using the shared utility
				const sessionConfig = await buildSessionConfig({
					projectId: conv.projectId,
					agentType: conv.agentType || "gemini",
					model: conv.agentModel,
					mode: conv.agentMode,
					reasoning: resolvedReasoning,
					cwd: conv.cwd,
				});

				console.warn(
					`Session ${input.sessionId} not found, restarting with command: ${sessionConfig.agentTemplate.agent.command}`,
				);

				startAgentSession(agentManagerInstance, input.sessionId, sessionConfig);
			}

			// Save the user message to store
			storeInstance.addMessage(input.sessionId, {
				id: generateUUID(),
				role: "user",
				content: input.message,
				timestamp: Date.now(),
			});

			const pendingHandover = agentManagerInstance.consumePendingHandover(
				input.sessionId,
			);
			const messageToSend = pendingHandover
				? `${pendingHandover}\n${input.message}`
				: input.message;

			agentManagerInstance.sendToSession(input.sessionId, messageToSend);

			return { success: true };
		}),

	stopSession: os
		.input(z.object({ sessionId: z.string() }))
		.output(z.object({ success: z.boolean() }))
		.handler(async ({ input }) => {
			const storeInstance = getStoreOrThrow();
			const success = getAgentManagerOrThrow().stopSession(input.sessionId);
			if (success) {
				storeInstance.addMessage(input.sessionId, {
					id: generateUUID(),
					role: "system",
					content: "Generation stopped by user.",
					timestamp: Date.now(),
					logType: "system",
				});
			}
			return { success };
		}),

	getMessages: os
		.input(z.object({ sessionId: z.string() }))
		.output(
			z.array(
				z.object({
					id: z.string(),
					role: z.enum(["user", "agent", "system"]),
					content: z.string(),
					timestamp: z.number(),
					logType: z
						.enum([
							"text",
							"tool_call",
							"tool_result",
							"thinking",
							"error",
							"system",
						])
						.optional(),
				}),
			),
		)
		.handler(async ({ input }) => {
			return getStoreOrThrow().getMessages(input.sessionId);
		}),

	addMessage: os
		.input(
			z.object({
				sessionId: z.string(),
				role: z.enum(["user", "agent", "system"]),
				content: z.string(),
				logType: z
					.enum([
						"text",
						"tool_call",
						"tool_result",
						"thinking",
						"error",
						"system",
					])
					.optional(),
			}),
		)
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
		.input(
			z.object({
				projectId: z.string().optional(),
			}),
		)
		.output(
			z.array(
				z.object({
					id: z.string(),
					projectId: z.string(),
					title: z.string(),
					createdAt: z.number(),
					updatedAt: z.number(),
					agentType: z.string().optional(),
					isProcessing: z.boolean().optional(),
				}),
			),
		)
		.handler(async ({ input }) => {
			const conversations = getStoreOrThrow().listConversations(input.projectId);
			const agentManager = getAgentManagerOrThrow();
			return conversations.map((c) => ({
				...c,
				isProcessing: agentManager.isProcessing?.(c.id) ?? false,
			}));
		}),

	swapConversationAgent: os
		.input(
			z.object({
				sessionId: z.string(),
				modelId: z.string().optional(),
				agentType: z.string().optional(),
				agentModel: z.string().optional(),
				reasoning: reasoningLevelSchema.optional(),
				mode: agentModeSchema.optional(),
			}),
		)
		.output(
			z.object({
				success: z.boolean(),
				message: z.string().optional(),
			}),
		)
		.handler(async ({ input }) => {
			const storeInstance = getStoreOrThrow();
			const agentManagerInstance = getAgentManagerOrThrow();

			const conv = storeInstance.getConversation(input.sessionId);
			if (!conv) {
				return {
					success: false,
					message: `Conversation not found: ${input.sessionId}`,
				};
			}

			const parsedModel = input.modelId ? parseModelId(input.modelId) : null;
			const resolvedAgentType =
				parsedModel?.agentType || input.agentType || conv.agentType;

			if (!resolvedAgentType) {
				return { success: false, message: "Model or agent type is required." };
			}

			const nextTemplate = getAgentTemplate(resolvedAgentType);
			if (!nextTemplate) {
				return {
					success: false,
					message: `Agent type not found: ${resolvedAgentType}`,
				};
			}

			const currentTemplate = conv.agentType
				? getAgentTemplate(conv.agentType)
				: undefined;
			const resolvedModel =
				parsedModel?.model || input.agentModel || conv.agentModel;
			const resolvedReasoning = resolveReasoning(
				nextTemplate.agent.type,
				resolvedModel,
				input.reasoning ?? conv.agentReasoning,
			);

			const project = storeInstance.getProject(conv.projectId);
			const cwd = project?.rootPath || nextTemplate.agent.cwd;

			const previousCliName = currentTemplate?.name || conv.agentType || "unknown";
			const previousModel = conv.agentModel || "default";
			const previousLabel = `${previousCliName} - ${previousModel}`;

			const nextCliName = nextTemplate.name;
			const nextModel = resolvedModel || "default";
			const nextLabel = `${nextCliName} - ${nextModel}`;

			const agentChanged = conv.agentType !== resolvedAgentType;
			const modelChanged = conv.agentModel !== resolvedModel;
			const reasoningChanged = conv.agentReasoning !== resolvedReasoning;
			const modeChanged = input.mode && input.mode !== conv.agentMode;
			const agentOrModelChanged = agentChanged || modelChanged || modeChanged;
			if (!agentOrModelChanged && !reasoningChanged) {
				return { success: true, message: "Agent settings unchanged." };
			}
			const systemMessage = agentOrModelChanged
				? `Switched agent from ${previousLabel} to ${nextLabel}.`
				: `Updated reasoning for ${nextLabel} to ${formatReasoningLabel(resolvedReasoning)}.`;

			if (modeChanged) {
				storeInstance.updateConversation(input.sessionId, {
					agentMode: input.mode,
				});
			}

			storeInstance.updateConversation(input.sessionId, {
				agentType: resolvedAgentType,
				agentModel: resolvedModel,
				agentReasoning: resolvedReasoning,
			});

			storeInstance.addMessage(input.sessionId, {
				id: generateUUID(),
				role: "system",
				content: systemMessage,
				timestamp: Date.now(),
				logType: "system",
			});

			// Prepare context handover data BEFORE resetting the session
			let handoverSummary: string | null = null;
			let handoverPreviousName = "";
			const pastMessages = storeInstance.getMessages(input.sessionId);
			const recent = pastMessages
				.filter(
					(m) =>
						(m.role === "user" || m.role === "agent") &&
						(!m.logType || m.logType === "text"),
				)
				.slice(-20);

			handoverPreviousName = currentTemplate?.name || conv.agentType || "unknown";

			if (recent.length > 0) {
				const historyText = recent
					.map((m) => `${m.role === "user" ? "User" : "Agent"}: ${m.content}`)
					.join("\n\n");

				// Get metadata BEFORE resetSession clears it
				const metadata = agentManagerInstance.getSessionMetadata(
					input.sessionId,
				);

				try {
					// Generate summary using the injected service
					const handoverService = getHandoverServiceOrThrow();
					if (cwd) {
						handoverSummary = await handoverService.generateAgentSummary({
							agentType: conv.agentType || "gemini",
							context: historyText,
							cwd,
							metadata,
							timeoutMs: HANDOVER_SUMMARY_TIMEOUT_MS,
						});
						if (handoverSummary) {
							console.info(
								"[ConversationsRouter] Handover summary generated (primary).",
							);
						}
					}
				} catch (error) {
					console.error(
						`[ConversationsRouter] Failed to generate summary: ${error}`,
					);
				}
			}

			if (!handoverSummary) {
				handoverSummary = buildFallbackSummary(recent);
				console.warn(
					"[ConversationsRouter] Using history fallback summary for handover.",
				);
			}

			// NOW reset the session after we've captured the metadata
			const resolvedMode = input.mode ?? conv.agentMode ?? "regular";

			const modePrompt = getModePrompt(resolvedMode);
			const projectRules = await resolveProjectRules(conv.projectId);
			const rulesContent = modePrompt
				? `${modePrompt}\n\n${projectRules}`
				: projectRules;

			agentManagerInstance.resetSession(
				input.sessionId,
				nextTemplate.agent.command,
				{
					...nextTemplate.agent,
					model: resolvedModel,
					reasoning: resolvedReasoning,
					mode: resolvedMode,
					cwd,
					rulesContent,
				},
			);

			// Store handover context to prepend to next user message (if we have one)
			if (handoverSummary) {
				const handoverContext = buildHandoverContext(
					handoverPreviousName,
					handoverSummary,
				);
				agentManagerInstance.setPendingHandover(
					input.sessionId,
					handoverContext,
				);
			}

			return { success: true, message: systemMessage };
		}),

	toggleConversationMcpTool: os
		.input(
			z.object({
				sessionId: z.string(),
				serverName: z.string(),
				toolName: z.string(),
				enabled: z.boolean(),
			}),
		)
		.output(z.object({ success: z.boolean() }))
		.handler(async ({ input }) => {
			const storeInstance = getStoreOrThrow();
			const conv = storeInstance.getConversation(input.sessionId);
			if (!conv) return { success: false };

			const currentDisabled = new Set(conv.disabledMcpTools || []);
			const key = `${input.serverName}-${input.toolName}`;

			if (input.enabled) {
				currentDisabled.delete(key);
			} else {
				currentDisabled.add(key);
			}

			storeInstance.updateConversation(input.sessionId, {
				disabledMcpTools: Array.from(currentDisabled),
			});
			return { success: true };
		}),
};
