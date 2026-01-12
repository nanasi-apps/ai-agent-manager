import type {
	AgentLogPayload,
	AgentMode,
	AgentStatePayload,
	McpServerEntry,
	ModelTemplate,
	ReasoningLevel,
} from "@agent-manager/shared";
import { defineStore } from "pinia";
import { computed, ref, watch } from "vue";
import { orpc } from "@/services/orpc";

export type LogType =
	| "text"
	| "tool_call"
	| "tool_result"
	| "thinking"
	| "error"
	| "system"
	| "plan";

export interface Message {
	id: string;
	role: "user" | "agent" | "system";
	content: string;
	timestamp: number;
	logType?: LogType;
	// Structured data for typed events
	toolCall?: {
		name: string;
		args: Record<string, unknown>;
	};
	toolResult?: {
		name: string;
		result: unknown;
		success: boolean;
		error?: string;
	};
	error?: {
		message: string;
		code?: string;
	};
}

export type { ModelTemplate, McpServerEntry };

export interface McpTool {
	name: string;
	description?: string;
	inputSchema?: unknown;
}

export const reasoningOptions: { label: string; value: ReasoningLevel }[] = [
	{ label: "Low", value: "low" },
	{ label: "Middle", value: "middle" },
	{ label: "High", value: "high" },
	{ label: "Extra High", value: "extraHigh" },
];

export const modeOptions: { label: string; value: AgentMode }[] = [
	{ label: "Ask", value: "ask" },
	{ label: "Plan", value: "plan" },
	{ label: "Agent", value: "regular" },
];

export const useConversationStore = defineStore("conversation", () => {
	// Core state
	const sessionId = ref("");
	const messages = ref<Message[]>([]);
	const input = ref("");
	const isLoading = ref(false);
	const isGenerating = ref(false);
	const isConnected = ref(false);

	// Title state
	const conversationTitle = ref("");
	const titleDraft = ref("");
	const isSavingTitle = ref(false);

	// Model state
	const modelTemplates = ref<ModelTemplate[]>([]);
	const modelIdDraft = ref("");
	const currentModelId = ref("");
	const conversationAgentType = ref<string | null>(null);
	const conversationAgentModel = ref<string | null>(null);
	const isSwappingModel = ref(false);
	const isUpdatingReasoning = ref(false);
	const isUpdatingMode = ref(false);

	// Reasoning/Mode state
	const reasoningDraft = ref<ReasoningLevel>("middle");
	const currentReasoning = ref<ReasoningLevel | null>(null);
	const modeDraft = ref<AgentMode>("regular");
	const currentMode = ref<AgentMode | null>(null);

	// Branch state
	const currentBranch = ref<string | null>(null);
	const projectId = ref<string | null>(null);

	// UI state
	const copiedId = ref<string | null>(null);
	const expandedMessageIds = ref(new Set<string>());

	// MCP state
	const isMcpSheetOpen = ref(false);
	const isLoadingMcp = ref(false);
	const sessionMcpServers = ref<McpServerEntry[]>([]);
	const globalMcpServers = ref<McpServerEntry[]>([]);
	const mcpAgentType = ref<string | undefined>();
	const expandedMcpServer = ref<string | null>(null);
	const mcpServerTools = ref<McpTool[]>([]);
	const isLoadingMcpTools = ref(false);
	const mcpToolsError = ref<string | null>(null);
	const disabledMcpTools = ref(new Set<string>());

	// Plan Viewer state
	const isPlanViewerOpen = ref(false);
	const isApproving = ref(false);

	// Dev Server state
	const devServer = ref<{
		isRunning: boolean;
		url?: string;
		pid?: number;
		type?: "web" | "process" | "other";
		error?: string;
		status?: "running" | "stopped" | "error";
		exitCode?: number | null;
	}>({ isRunning: false });

	// Computed
	const selectedModelTemplate = computed(() =>
		modelTemplates.value.find((m) => m.id === modelIdDraft.value),
	);

	const latestPlanContent = computed(() => {
		// Find the last message with logType 'plan'
		for (let i = messages.value.length - 1; i >= 0; i--) {
			const msg = messages.value[i];
			if (msg && msg.logType === "plan") {
				return msg.content;
			}
		}
		return "";
	});

	const supportsReasoning = computed(() => {
		const template = selectedModelTemplate.value;
		if (!template || template.agentType !== "codex") return false;
		if (!template.model) return true;
		return template.model.toLowerCase().startsWith("gpt");
	});

	const isUpdatingAgent = computed(
		() =>
			isSwappingModel.value ||
			isUpdatingReasoning.value ||
			isUpdatingMode.value,
	);

	// Helpers
	const matchesStateValue = (
		value: AgentStatePayload["value"],
		target: string,
	): boolean => {
		if (typeof value === "string") return value === target;
		if (!value || typeof value !== "object") return false;
		if (target in value) return true;
		return Object.values(value).some((child) =>
			matchesStateValue(child as AgentStatePayload["value"], target),
		);
	};

	const formatModelLabel = (model: ModelTemplate) => {
		if (!model.agentName || model.name.includes(model.agentName)) {
			return model.name;
		}
		return `${model.name} (${model.agentName})`;
	};

	const formatReasoningLabel = (level: ReasoningLevel) => {
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
				return level;
		}
	};

	const formatModeLabel = (mode: AgentMode) => {
		switch (mode) {
			case "plan":
				return "Plan";
			case "regular":
				return "Agent";
			case "ask":
				return "Ask";
			default:
				return mode;
		}
	};

	const formatTime = (timestamp: number) => {
		return new Date(timestamp).toLocaleTimeString([], {
			hour: "2-digit",
			minute: "2-digit",
		});
	};

	// Message helpers
	const getLogSummary = (msg: Message) => {
		const type = msg.logType;

		if (type === "tool_call") {
			if (msg.toolCall) {
				return `Tool: ${msg.toolCall.name}`;
			}
			return "Tool Call";
		}

		if (type === "tool_result") {
			if (msg.toolResult) {
				return `Result: ${msg.toolResult.name}`;
			}
			return "Tool Result";
		}

		if (type === "error") return "Error";
		if (type === "thinking") return "Thinking";
		if (type === "plan") return "Implementation Plan";

		if (type === "system") {
			return "System";
		}

		return type?.replace("_", " ") || "Log";
	};

	const hasContent = (msg: Message) => {
		return msg.content && msg.content.trim().length > 0;
	};

	const isAlwaysOpen = (msg: Message) => {
		return msg.logType === "system" && hasContent(msg);
	};

	const toggleMessage = (id: string) => {
		if (expandedMessageIds.value.has(id)) {
			expandedMessageIds.value.delete(id);
		} else {
			expandedMessageIds.value.add(id);
		}
	};

	const copyMessage = async (content: string, id: string) => {
		try {
			const plainText = content.replace(/<[^>]*>/g, "");
			await navigator.clipboard.writeText(plainText);
			copiedId.value = id;
			// biome-ignore lint/suspicious/noAssignInExpressions: <explanation>
			setTimeout(() => (copiedId.value = null), 2000);
		} catch (err) {
			console.error("Failed to copy:", err);
		}
	};

	// API calls
	const loadModelTemplates = async () => {
		try {
			modelTemplates.value = await orpc.listModelTemplates({});
			if (!modelIdDraft.value) {
				applyConversationModelSelection();
			}
		} catch (err) {
			console.error("Failed to load model templates:", err);
		}
	};

	const applyConversationModelSelection = () => {
		if (modelTemplates.value.length === 0) return;

		const match = modelTemplates.value.find(
			(template) =>
				template.agentType === conversationAgentType.value &&
				(template.model || "") === (conversationAgentModel.value || ""),
		);

		const preferred = modelTemplates.value.find(
			(model) => model.agentType !== "default",
		);
		const nextId =
			match?.id ?? preferred?.id ?? modelTemplates.value[0]?.id ?? "";
		currentModelId.value = nextId;
		modelIdDraft.value = nextId;
	};

	const setModelFromConversation = (
		agentType?: string,
		agentModel?: string,
		agentReasoning?: ReasoningLevel,
		agentMode?: AgentMode,
	) => {
		conversationAgentType.value = agentType || null;
		conversationAgentModel.value = agentModel || null;
		applyConversationModelSelection();
		const nextReasoning = agentReasoning ?? "middle";
		currentReasoning.value = nextReasoning;
		reasoningDraft.value = nextReasoning;

		const nextMode = agentMode ?? "regular";
		currentMode.value = nextMode;
		modeDraft.value = nextMode;
	};

	const loadBranchInfo = async (sid: string, pid?: string) => {
		try {
			currentBranch.value = await orpc.getCurrentBranch({
				sessionId: sid,
				projectId: pid,
			});
		} catch (e) {
			console.error("Failed to load branch info:", e);
			currentBranch.value = null;
		}
	};

	const loadConversationMeta = async (id: string) => {
		try {
			const conv = await orpc.getConversation({ sessionId: id });
			if (conv) {
				conversationTitle.value = conv.title;
				titleDraft.value = conv.title;
				projectId.value = conv.projectId;
				setModelFromConversation(
					conv.agentType,
					conv.agentModel,
					conv.agentReasoning,
					conv.agentMode,
				);
				loadBranchInfo(id, conv.projectId);
				if (conv.disabledMcpTools) {
					disabledMcpTools.value = new Set(conv.disabledMcpTools);
				} else {
					disabledMcpTools.value = new Set();
				}
			} else {
				conversationTitle.value = "Untitled Session";
				titleDraft.value = conversationTitle.value;
				projectId.value = null;
				setModelFromConversation(undefined, undefined, undefined, undefined);
			}
		} catch (err) {
			console.error("Failed to load conversation metadata:", err);
		}
	};

	const loadConversation = async (id: string) => {
		if (id === "new") {
			if (!modelIdDraft.value) {
				applyConversationModelSelection();
			}
			return;
		}
		try {
			await loadConversationMeta(id);
			const running = await orpc.isAgentRunning({ sessionId: id });
			isGenerating.value = running;

			// Load Dev Server Status
			if (projectId.value) {
				await loadDevServerStatus(projectId.value, id);
			}

			const savedMessages = await orpc.getMessages({ sessionId: id });
			if (savedMessages && savedMessages.length > 0) {
				messages.value = savedMessages.map((m) => ({
					id: m.id,
					role: m.role,
					content: m.content,
					timestamp: m.timestamp,
					logType: m.logType,
				}));
			}
		} catch (err) {
			console.error("Failed to load conversation:", err);
		}
	};

	const normalizeTitle = (value: string) => {
		const trimmed = value.trim();
		return trimmed.length ? trimmed : "Untitled Session";
	};

	const saveTitle = async () => {
		const nextTitle = normalizeTitle(titleDraft.value);
		if (nextTitle === conversationTitle.value || isSavingTitle.value) {
			titleDraft.value = conversationTitle.value;
			return;
		}

		isSavingTitle.value = true;
		try {
			const result = await orpc.updateConversationTitle({
				sessionId: sessionId.value,
				title: nextTitle,
			});
			if (result.success) {
				conversationTitle.value = nextTitle;
				titleDraft.value = nextTitle;
				window.dispatchEvent(new Event("agent-manager:data-change"));
			}
		} catch (err) {
			console.error("Failed to update conversation title:", err);
			titleDraft.value = conversationTitle.value;
		} finally {
			isSavingTitle.value = false;
		}
	};

	const swapModel = async () => {
		const nextId = modelIdDraft.value;
		if (!nextId || nextId === currentModelId.value || isSwappingModel.value)
			return;
		if (sessionId.value === "new") {
			currentModelId.value = nextId;
			return;
		}

		const previousId = currentModelId.value;
		isSwappingModel.value = true;
		const nextTemplate = modelTemplates.value.find((m) => m.id === nextId);
		const nextName = nextTemplate
			? formatModelLabel(nextTemplate)
			: "next agent";

		messages.value.push({
			id: crypto.randomUUID(),
			role: "system",
			content: `Handing over conversation to **${nextName}**...`,
			timestamp: Date.now(),
			logType: "system",
		});

		try {
			const result = await orpc.swapConversationAgent({
				sessionId: sessionId.value,
				modelId: nextId,
				reasoning: supportsReasoning.value ? reasoningDraft.value : undefined,
			});
			if (!result.success) {
				throw new Error(result.message || "Failed to swap model");
			}

			currentModelId.value = nextId;
			currentReasoning.value = supportsReasoning.value
				? reasoningDraft.value
				: null;
			if (result.message) {
				messages.value.push({
					id: crypto.randomUUID(),
					role: "system",
					content: result.message,
					timestamp: Date.now(),
					logType: "system",
				});
			}
			window.dispatchEvent(new Event("agent-manager:data-change"));
		} catch (err) {
			console.error("Failed to swap model:", err);
			modelIdDraft.value = previousId;
			messages.value.push({
				id: crypto.randomUUID(),
				role: "system",
				content: `Failed to swap model: ${err}`,
				timestamp: Date.now(),
				logType: "error",
			});
		} finally {
			isSwappingModel.value = false;
		}
	};

	const updateReasoning = async () => {
		if (!supportsReasoning.value) return;

		const nextReasoning = reasoningDraft.value;
		if (nextReasoning === currentReasoning.value || isUpdatingReasoning.value)
			return;
		if (sessionId.value === "new") {
			currentReasoning.value = nextReasoning;
			return;
		}

		isUpdatingReasoning.value = true;
		messages.value.push({
			id: crypto.randomUUID(),
			role: "system",
			content: `Updating reasoning to **${formatReasoningLabel(nextReasoning)}**...`,
			timestamp: Date.now(),
			logType: "system",
		});

		try {
			const result = await orpc.swapConversationAgent({
				sessionId: sessionId.value,
				modelId: currentModelId.value,
				reasoning: nextReasoning,
			});
			if (!result.success) {
				throw new Error(result.message || "Failed to update reasoning");
			}

			currentReasoning.value = nextReasoning;
			if (result.message) {
				messages.value.push({
					id: crypto.randomUUID(),
					role: "system",
					content: result.message,
					timestamp: Date.now(),
					logType: "system",
				});
			}
			window.dispatchEvent(new Event("agent-manager:data-change"));
		} catch (err) {
			console.error("Failed to update reasoning:", err);
			reasoningDraft.value = currentReasoning.value ?? "middle";
			messages.value.push({
				id: crypto.randomUUID(),
				role: "system",
				content: `Failed to update reasoning: ${err}`,
				timestamp: Date.now(),
				logType: "error",
			});
		} finally {
			isUpdatingReasoning.value = false;
		}
	};

	const updateMode = async () => {
		const nextMode = modeDraft.value;
		if (nextMode === currentMode.value || isUpdatingMode.value) return;
		if (sessionId.value === "new") {
			currentMode.value = nextMode;
			return;
		}

		isUpdatingMode.value = true;
		messages.value.push({
			id: crypto.randomUUID(),
			role: "system",
			content: `Updating mode to **${formatModeLabel(nextMode)}**...`,
			timestamp: Date.now(),
			logType: "system",
		});

		try {
			const result = await orpc.swapConversationAgent({
				sessionId: sessionId.value,
				mode: nextMode,
			});
			if (!result.success) {
				throw new Error(result.message || "Failed to update mode");
			}

			currentMode.value = nextMode;
			if (result.message) {
				messages.value.push({
					id: crypto.randomUUID(),
					role: "system",
					content: result.message,
					timestamp: Date.now(),
					logType: "system",
				});
			}
			window.dispatchEvent(new Event("agent-manager:data-change"));
		} catch (err) {
			console.error("Failed to update mode:", err);
			modeDraft.value = currentMode.value ?? "regular";
			messages.value.push({
				id: crypto.randomUUID(),
				role: "system",
				content: `Failed to update mode: ${err}`,
				timestamp: Date.now(),
				logType: "error",
			});
		} finally {
			isUpdatingMode.value = false;
		}
	};

	const appendAgentLog = (payload: AgentLogPayload) => {
		const content = payload.data;
		if (!content.trim()) return;

		const incomingType = payload.type || "text";
		const incomingRole = incomingType === "system" ? "system" : "agent";

		const lastMsg = messages.value[messages.value.length - 1];

		let merged = false;
		if (lastMsg) {
			const lastType = lastMsg.logType || "text";

			// Only merge text logs
			if (
				lastMsg.role === incomingRole &&
				incomingType === "text" &&
				lastType === "text"
			) {
				lastMsg.content += content;
				merged = true;
			} else if (incomingType !== "text" && incomingType === lastType) {
				// Don't merge non-text logs usually, unless it is specifically implemented
				// For system logs we might merge
				if (incomingType === "system") {
					lastMsg.content += `\n${content}`;
					merged = true;
				}
			}
		}

		if (!merged) {
			messages.value.push({
				id: crypto.randomUUID(),
				role: incomingRole,
				content,
				timestamp: Date.now(),
				logType: incomingType as LogType,
			});

			if (incomingType === "plan") {
				isPlanViewerOpen.value = true;
				isMcpSheetOpen.value = false;
			}
		}
	};

	const addToolCall = (payload: {
		toolName: string;
		arguments: Record<string, unknown>;
	}) => {
		messages.value.push({
			id: crypto.randomUUID(),
			role: "agent",
			content: JSON.stringify(payload.arguments, null, 2),
			timestamp: Date.now(),
			logType: "tool_call",
			toolCall: {
				name: payload.toolName,
				args: payload.arguments,
			},
		});
	};

	const addToolResult = (payload: {
		toolName: string;
		result: unknown;
		success: boolean;
		error?: string;
	}) => {
		let content = "";
		if (typeof payload.result === "string") {
			content = payload.result;
		} else {
			content = JSON.stringify(payload.result, null, 2);
		}

		messages.value.push({
			id: crypto.randomUUID(),
			role: "agent",
			content: content,
			timestamp: Date.now(),
			logType: "tool_result",
			toolResult: {
				name: payload.toolName,
				result: payload.result,
				success: payload.success,
				error: payload.error,
			},
		});
	};

	const addThinking = (payload: { content: string }) => {
		// Thinking events might come in chunks in the future, currently treated as discrete
		// Or if we want streaming thinking, we might need merge logic similar to text logs
		const lastMsg = messages.value[messages.value.length - 1];
		if (lastMsg && lastMsg.logType === "thinking") {
			lastMsg.content += payload.content;
			return;
		}

		messages.value.push({
			id: crypto.randomUUID(),
			role: "agent",
			content: payload.content,
			timestamp: Date.now(),
			logType: "thinking",
		});
	};

	const addError = (payload: {
		message: string;
		code?: string;
		details?: unknown;
	}) => {
		messages.value.push({
			id: crypto.randomUUID(),
			role: "system",
			content: payload.message,
			timestamp: Date.now(),
			logType: "error",
			error: {
				message: payload.message,
				code: payload.code,
			},
		});
	};

	const sendMessage = async (scrollToBottom: () => void) => {
		if (!input.value.trim()) return;
		// Prevent duplicate sends
		if (isLoading.value) return;
		isLoading.value = true;

		// If creating a new session
		if (sessionId.value === "new") {
			if (!projectId.value || !modelIdDraft.value) {
				console.error("Missing project or model for new conversation");
				isLoading.value = false;
				return;
			}

			const messageText = input.value;
			input.value = "";

			// Add user message optimistic
			messages.value.push({
				id: crypto.randomUUID(),
				role: "user",
				content: messageText,
				timestamp: Date.now(),
			});
			scrollToBottom();
			isGenerating.value = true;

			try {
				const res = await orpc.createConversation({
					projectId: projectId.value,
					initialMessage: messageText,
					modelId: modelIdDraft.value,
					reasoning: supportsReasoning.value ? reasoningDraft.value : undefined,
					mode: modeDraft.value,
				});

				// Update session ID locally
				sessionId.value = res.sessionId;

				// Load metadata (title, etc) for the newly created session
				await loadConversationMeta(res.sessionId);

				// IMPORTANT: Dispatch event is sufficient for sidebar, but the caller needs to update URL
				window.dispatchEvent(new Event("agent-manager:data-change"));

				// We do NOT call sendMessage because createConversation already started it.
				// We just need to start listening to events for this new ID.
				// The caller (ConversationView) needs to react to sessionId change but NOT clear state.
			} catch (err) {
				console.error("Failed to create conversation", err);
				isGenerating.value = false;
				messages.value.push({
					id: crypto.randomUUID(),
					role: "system",
					content: `Failed to create conversation: ${err}`,
					timestamp: Date.now(),
					logType: "error",
				});
			} finally {
				isLoading.value = false;
			}
			return;
		}

		if (modelIdDraft.value && modelIdDraft.value !== currentModelId.value) {
			if (isSwappingModel.value) {
				while (isSwappingModel.value) {
					await new Promise((resolve) => setTimeout(resolve, 100));
				}
			} else {
				await swapModel();
			}

			if (currentModelId.value !== modelIdDraft.value) {
				isLoading.value = false;
				return;
			}
		}

		const messageText = input.value;
		input.value = "";

		messages.value.push({
			id: crypto.randomUUID(),
			role: "user",
			content: messageText,
			timestamp: Date.now(),
		});

		scrollToBottom();

		isGenerating.value = true;

		try {
			await orpc.sendMessage({
				sessionId: sessionId.value,
				message: messageText,
			});
		} catch (err) {
			console.error("Failed to send message", err);
			isGenerating.value = false;
			messages.value.push({
				id: crypto.randomUUID(),
				role: "system",
				content: `Failed to send message: ${err}`,
				timestamp: Date.now(),
				logType: "error",
			});
		} finally {
			isLoading.value = false;
		}
	};

	const stopGeneration = async () => {
		try {
			await orpc.stopSession({ sessionId: sessionId.value });
		} catch (err) {
			console.error("Failed to stop session:", err);
		}
		isGenerating.value = false;
		isLoading.value = false;
	};

	// MCP functions
	const loadMcpServers = async () => {
		isLoadingMcp.value = true;
		try {
			const result = await orpc.getSessionMcpServers({
				sessionId: sessionId.value,
			});
			sessionMcpServers.value = result.sessionServers;
			globalMcpServers.value = result.globalServers;
			mcpAgentType.value = result.agentType;
		} catch (err) {
			console.error("Failed to load MCP servers:", err);
		} finally {
			isLoadingMcp.value = false;
		}
	};

	const loadDevServerStatus = async (pid: string, cid: string) => {
		try {
			const status = await orpc.devServerStatus({
				projectId: pid,
				conversationId: cid,
			});
			if (status) {
				devServer.value = {
					isRunning: status.status === "running",
					url: status.url,
					pid: status.pid,
					type: status.type,
					status: status.status as "running" | "stopped" | "error", // Ensure strict typing
					// @ts-expect-error - ORPC types might need regeneration
					exitCode: status.exitCode,
				};
			} else {
				devServer.value = { isRunning: false };
			}
		} catch (e) {
			console.error("Error loading dev server status:", e);
			devServer.value = { isRunning: false, error: String(e) };
		}
	};

	const fetchDevServerLogs = async (pid: string, cid: string) => {
		try {
			const logs = await orpc.devServerLogs({
				projectId: pid,
				conversationId: cid,
			});
			return logs;
		} catch (e) {
			console.error("Error fetching dev server logs:", e);
			return [];
		}
	};

	const launchDevServer = async () => {
		if (!projectId.value) return;
		if (devServer.value.isRunning) return;

		// Optimistic update
		const originalState = { ...devServer.value };
		devServer.value = { ...devServer.value, isRunning: true }; // Prevent double clicks immediately

		try {
			const result = await orpc.devServerLaunch({
				projectId: projectId.value,
				conversationId: sessionId.value,
			});
			devServer.value = {
				isRunning: true,
				url: result.url,
				pid: result.pid,
				type: result.type,
			};
		} catch (e) {
			console.error("Failed to launch dev server:", e);
			devServer.value = { ...originalState, error: String(e) }; // Revert on failure
			messages.value.push({
				id: crypto.randomUUID(),
				role: "system",
				content: `Failed to launch dev server: ${e}`,
				timestamp: Date.now(),
				logType: "error",
			});
		}
	};

	const stopDevServer = async () => {
		if (!projectId.value) return;

		try {
			await orpc.devServerStop({
				projectId: projectId.value,
				conversationId: sessionId.value,
			});
			devServer.value = { isRunning: false };
		} catch (e) {
			console.error("Failed to stop dev server:", e);
		}
	};

	const toggleMcpSheet = () => {
		isMcpSheetOpen.value = !isMcpSheetOpen.value;
		if (isMcpSheetOpen.value) {
			loadMcpServers();
		}
	};

	const getMcpConnectionInfo = (server: McpServerEntry) => {
		if (server.config.url) {
			return server.config.url;
		}
		if (server.config.command) {
			const args = server.config.args?.join(" ") || "";
			return `${server.config.command} ${args}`.trim();
		}
		return "—";
	};

	const loadMcpServerTools = async (server: McpServerEntry) => {
		isLoadingMcpTools.value = true;
		mcpToolsError.value = null;
		mcpServerTools.value = [];
		try {
			const serverForUi = { ...server };
			if (serverForUi.config?.url) {
				const url = new URL(serverForUi.config.url);
				url.searchParams.set("superuser", "true");
				serverForUi.config.url = url.toString();
			}
			const result = await orpc.listMcpTools(serverForUi);
			mcpServerTools.value = result;
		} catch (err: unknown) {
			console.error("Failed to load MCP tools:", err);
			mcpToolsError.value =
				err instanceof Error ? err.message : "Failed to load tools";
		} finally {
			isLoadingMcpTools.value = false;
		}
	};

	const isToolDisabled = (server: McpServerEntry, tool: McpTool) => {
		return disabledMcpTools.value.has(`${server.name} - ${tool.name}`);
	};

	const handleToolClick = async (server: McpServerEntry, tool: McpTool) => {
		const key = `${server.name} - ${tool.name}`;
		const isCurrentlyDisabled = disabledMcpTools.value.has(key);
		const nextEnabled = isCurrentlyDisabled;

		if (nextEnabled) {
			disabledMcpTools.value.delete(key);
		} else {
			disabledMcpTools.value.add(key);
		}

		try {
			await orpc.toggleConversationMcpTool({
				sessionId: sessionId.value,
				serverName: server.name,
				toolName: tool.name,
				enabled: nextEnabled,
			});
		} catch (err) {
			console.error("Failed to toggle tool:", err);
			if (nextEnabled) {
				disabledMcpTools.value.add(key);
			} else {
				disabledMcpTools.value.delete(key);
			}
		}
	};

	const toggleMcpServer = (server: McpServerEntry) => {
		const serverKey = `${server.source} - ${server.name}`;
		if (expandedMcpServer.value === serverKey) {
			expandedMcpServer.value = null;
			mcpServerTools.value = [];
			mcpToolsError.value = null;
		} else {
			expandedMcpServer.value = serverKey;
			loadMcpServerTools(server);
		}
	};

	// Plan Viewer functions
	const togglePlanViewer = () => {
		isPlanViewerOpen.value = !isPlanViewerOpen.value;
		// If opening plan viewer, ensure MCP sheet is closed to avoid clutter?
		// Or allow both? Let's allow one sidebar at a time for now for better UX on small screens
		if (isPlanViewerOpen.value) {
			isMcpSheetOpen.value = false;
		}
	};

	/**
	 * Approve and execute the current plan with selected model
	 */
	const approvePlan = async (modelId: string, sendToInbox = false) => {
		const planContent = latestPlanContent.value;
		if (!planContent.trim()) {
			console.warn("No plan content to approve");
			return { success: false, message: "No plan content" };
		}

		isApproving.value = true;

		try {
			if (sendToInbox) {
				// Create approval request and send to inbox
				const result = await orpc.createApproval({
					sessionId: sessionId.value,
					projectId: projectId.value || "",
					planContent,
				});

				if (result.success) {
					messages.value.push({
						id: crypto.randomUUID(),
						role: "system",
						content: "Plan sent to Inbox for approval.",
						timestamp: Date.now(),
						logType: "system",
					});
					isPlanViewerOpen.value = false;
				}

				return result;
			}
			// Direct execution - approve and execute immediately
			const result = await orpc.createApproval({
				sessionId: sessionId.value,
				projectId: projectId.value || "",
				planContent,
			});

			if (!result.success) {
				return { success: false, message: "Failed to create approval" };
			}

			// Execute immediately
			const execResult = await orpc.approveAndExecute({
				id: result.id,
				modelId,
			});

			if (execResult.success) {
				isPlanViewerOpen.value = false;
				isGenerating.value = true;
			}

			return execResult;
		} catch (err) {
			console.error("Failed to approve plan:", err);
			messages.value.push({
				id: crypto.randomUUID(),
				role: "system",
				content: `Failed to approve plan: ${err}`,
				timestamp: Date.now(),
				logType: "error",
			});
			return { success: false, message: String(err) };
		} finally {
			isApproving.value = false;
		}
	};

	// Initialize for a session
	function initSession(initialSessionId: string) {
		sessionId.value = initialSessionId;
		messages.value = [];
		input.value = "";
		isLoading.value = false;
		isGenerating.value = false;
		isConnected.value = false;
		conversationTitle.value = "";
		titleDraft.value = "";
		currentBranch.value = null;
		projectId.value = null;
		expandedMessageIds.value = new Set();
		isMcpSheetOpen.value = false;
		sessionMcpServers.value = [];
		globalMcpServers.value = [];
		mcpServerTools.value = [];
		disabledMcpTools.value = new Set();
		isPlanViewerOpen.value = false;
	}

	// Reset store state
	function $reset() {
		initSession("");
		modelTemplates.value = [];
		modelIdDraft.value = "";
		currentModelId.value = "";
		conversationAgentType.value = null;
		conversationAgentModel.value = null;
		reasoningDraft.value = "middle";
		currentReasoning.value = null;
		modeDraft.value = "regular";
		currentMode.value = null;
	}

	// Setup watchers
	const setupWatchers = () => {
		// Auto-open plan viewer when switching to plan mode?
		watch(currentMode, (newMode) => {
			if (newMode === "plan") {
				// isPlanViewerOpen.value = true;
				// Maybe don't auto-open yet, let user decide
			}
		});

		watch(modelIdDraft, async (newVal) => {
			if (newVal && newVal !== currentModelId.value) {
				await swapModel();
			}
		});

		watch(reasoningDraft, async (newVal) => {
			if (!supportsReasoning.value) return;
			if (newVal === currentReasoning.value) return;
			if (isSwappingModel.value || isUpdatingReasoning.value) return;
			await updateReasoning();
		});

		watch(modeDraft, async (newVal) => {
			if (newVal === currentMode.value) return;
			if (
				isSwappingModel.value ||
				isUpdatingReasoning.value ||
				isUpdatingMode.value
			)
				return;
			await updateMode();
		});

		watch(modelTemplates, () => {
			applyConversationModelSelection();
		});
	};

	return {
		// State
		sessionId,
		messages,
		input,
		isLoading,
		isGenerating,
		isConnected,
		conversationTitle,
		titleDraft,
		isSavingTitle,
		modelTemplates,
		modelIdDraft,
		currentModelId,
		conversationAgentType,
		conversationAgentModel,
		isSwappingModel,
		isUpdatingReasoning,
		isUpdatingMode,
		reasoningDraft,
		currentReasoning,
		modeDraft,
		currentMode,
		currentBranch,
		projectId,
		copiedId,
		expandedMessageIds,
		isMcpSheetOpen,
		isLoadingMcp,
		sessionMcpServers,
		globalMcpServers,
		mcpAgentType,
		expandedMcpServer,
		mcpServerTools,
		isLoadingMcpTools,
		mcpToolsError,
		disabledMcpTools,

		// Plan Viewer
		isPlanViewerOpen,
		latestPlanContent,
		isApproving,

		// Computed
		selectedModelTemplate,
		supportsReasoning,
		isUpdatingAgent,

		// Helpers
		matchesStateValue,
		formatModelLabel,
		formatReasoningLabel,
		formatModeLabel,
		formatTime,
		getLogSummary,
		hasContent,
		isAlwaysOpen,
		toggleMessage,
		copyMessage,
		loadModelTemplates,
		loadConversation,
		saveTitle,
		sendMessage,
		stopGeneration,

		// MCP Methods
		loadMcpServers,
		toggleMcpSheet,
		getMcpConnectionInfo,
		toggleMcpServer,
		handleToolClick,
		isToolDisabled,

		// Plan Viewer Methods
		togglePlanViewer,
		approvePlan,

		// Setup
		setupWatchers,
		appendAgentLog,
		addToolCall,
		addToolResult,
		addThinking,
		addError,
		initSession,
		$reset,

		swapModel,
		updateReasoning,
		updateMode,
		setModelFromConversation,

		// Dev Server
		devServer,
		loadDevServerStatus,
		fetchDevServerLogs,
		launchDevServer,
		stopDevServer,
	};
});
