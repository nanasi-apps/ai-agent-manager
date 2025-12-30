<script setup lang="ts">
import type {
	AgentLogPayload,
	AgentMode,
	AgentStatePayload,
	ReasoningLevel,
} from "@agent-manager/shared";
import {
	AlertCircle,
	Check,
	ChevronDown,
	ChevronRight,
	Copy,
	Cpu,
	GitBranch,
	Loader2,
	Plug,
	Send,
	Server,
	Sparkles,
	Square,
	Terminal,
	X,
} from "lucide-vue-next";
import { computed, nextTick, onMounted, ref, watch } from "vue";
import { onBeforeRouteLeave, useRoute } from "vue-router";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	ResizableHandle,
	ResizablePanel,
	ResizablePanelGroup,
} from "@/components/ui/resizable";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { useMarkdown } from "@/composables/useMarkdown";
import { onAgentStateChangedPort } from "@/services/agent-state-port";
import { orpc } from "@/services/orpc";

type LogType =
	| "text"
	| "tool_call"
	| "tool_result"
	| "thinking"
	| "error"
	| "system";

interface Message {
	id: string;
	role: "user" | "agent" | "system";
	content: string;
	timestamp: number;
	logType?: LogType;
}

interface ModelTemplate {
	id: string;
	name: string;
	agentType: string;
	agentName: string;
	model?: string;
}

const route = useRoute();
const { renderMarkdown } = useMarkdown();
const sessionId = ref((route.params as unknown as { id: string }).id);
const input = ref("");
const messages = ref<Message[]>([]);
const isLoading = ref(false);
const isGenerating = ref(false);
const isConnected = ref(false);
const conversationTitle = ref("");
const titleDraft = ref("");
const isSavingTitle = ref(false);
const copiedId = ref<string | null>(null);
const expandedMessageIds = ref(new Set<string>());
const modelTemplates = ref<ModelTemplate[]>([]);
const modelIdDraft = ref("");
const currentModelId = ref("");
const conversationAgentType = ref<string | null>(null);
const conversationAgentModel = ref<string | null>(null);
const isSwappingModel = ref(false);
const isUpdatingReasoning = ref(false);
const isUpdatingMode = ref(false);
const currentBranch = ref<string | null>(null);
const projectId = ref<string | null>(null);

// MCP related state
interface McpServerEntry {
	name: string;
	source: 'gemini' | 'claude-desktop' | 'claude-code' | 'agent-manager';
	enabled: boolean;
	config: {
		url?: string;
		command?: string;
		args?: string[];
		type?: string;
	};
}
interface McpTool {
	name: string;
	description?: string;
	inputSchema?: unknown;
}
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

const reasoningDraft = ref<ReasoningLevel>("middle");
const currentReasoning = ref<ReasoningLevel | null>(null);
const modeDraft = ref<AgentMode>("regular");
const currentMode = ref<AgentMode | null>(null);

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

const reasoningOptions: { label: string; value: ReasoningLevel }[] = [
	{ label: "Low", value: "low" },
	{ label: "Middle", value: "middle" },
	{ label: "High", value: "high" },
	{ label: "Extra High", value: "extraHigh" },
];

const modeOptions: { label: string; value: AgentMode }[] = [
	{ label: "Ask", value: "ask" },
	{ label: "Plan", value: "plan" },
	{ label: "Agent", value: "regular" },
];

const selectedModelTemplate = computed(() =>
	modelTemplates.value.find((m) => m.id === modelIdDraft.value),
);

const supportsReasoning = computed(() => {
	const template = selectedModelTemplate.value;
	if (!template || template.agentType !== "codex") return false;
	if (!template.model) return true;
	return template.model.toLowerCase().startsWith("gpt");
});

const isUpdatingAgent = computed(
	() => isSwappingModel.value || isUpdatingReasoning.value || isUpdatingMode.value,
);

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

const scrollAreaRef = ref<InstanceType<typeof ScrollArea> | null>(null);
const messagesEndRef = ref<HTMLElement | null>(null);

const toggleMessage = (id: string) => {
	if (expandedMessageIds.value.has(id)) {
		expandedMessageIds.value.delete(id);
	} else {
		expandedMessageIds.value.add(id);
	}
};

const getScrollViewport = () => {
	if (!scrollAreaRef.value) return null;
	const component = scrollAreaRef.value as any;
	// Handle both Vue component (with $el) and direct element
	const el = (component.$el || component) as HTMLElement;
	
	if (!el || typeof el.querySelector !== 'function') return null;

	// Scope strictly to this component's scroll area
	return el.querySelector("[data-radix-scroll-area-viewport]") as HTMLElement;
};

const saveScrollPosition = (id: string) => {
	if (!id) return;

	const viewport = getScrollViewport();
	if (viewport) {
		sessionStorage.setItem(`scroll-pos-${id}`, viewport.scrollTop.toString());
	}
};

const restoreScrollPosition = async () => {
	await nextTick();
	const key = `scroll-pos-${sessionId.value}`;
	const saved = sessionStorage.getItem(key);

	if (saved !== null) {
		const viewport = getScrollViewport();
		if (viewport) {
			viewport.scrollTop = parseInt(saved, 10);
			return;
		}
	}

	// Fallback to bottom if no saved position
	await scrollToBottom(false);
};

const scrollToBottom = async (smooth = true) => {
	await nextTick();

	// Method 1: Use messagesEndRef if available
	if (messagesEndRef.value) {
		messagesEndRef.value.scrollIntoView({
			behavior: smooth ? "smooth" : "instant",
		});
		return;
	}

	// Method 2: Fallback to viewport scroll
	const viewport = getScrollViewport();

	if (viewport) {
		if (smooth) {
			viewport.scrollTo({ top: viewport.scrollHeight, behavior: "smooth" });
		} else {
			viewport.scrollTop = viewport.scrollHeight;
		}
	}
};

const copyMessage = async (content: string, id: string) => {
	try {
		// Strip HTML tags for plain text copy
		const plainText = content.replace(/<[^>]*>/g, "");
		await navigator.clipboard.writeText(plainText);
		copiedId.value = id;
		setTimeout(() => (copiedId.value = null), 2000);
	} catch (err) {
		console.error("Failed to copy:", err);
	}
};

const getLogSummary = (msg: Message) => {
	const content = msg.content || "";
	const type = msg.logType;

	if (type === "tool_call") {
		const toolMatch = content.match(/\[Tool: ([^\]]+)\]/);
		if (toolMatch) return toolMatch[1];
		const execMatch = content.match(/\[Executing: ([^\]]+)\]/);
		if (execMatch) return execMatch[1];
		return "Tool Call";
	}

	if (type === "tool_result") {
		const resultMatch = content.match(/\[Result: ([^\]]+)\]/);
		if (resultMatch) return `Result (${resultMatch[1]})`;
		if (content.includes("[Output]")) return "Output";
		if (content.includes("[File ")) return "File Change";
		return "Tool Result";
	}

	if (type === "error") return "Error";
	if (type === "thinking") return "Thinking";

	if (type === "system") {
		const modelMatch = content.match(/\[Using model: ([^\]]+)\]/);
		if (modelMatch) return `Model: ${modelMatch[1]}`;
		return "System";
	}

	return type?.replace("_", " ") || "Log";
};

const getCleanContent = (content: string, logType?: LogType) => {
	if (!logType || logType === "text") return content.trim();

	let clean = content;
	// Remove known prefixes to show cleaner content in the expanded view
	const prefixes = [
		/^\s*\[Tool: [^\]]+\]\s*/,
		/^\s*\[Executing: [^\]]+\]\s*/,
		/^\s*\[Result(: [^\]]+)?\]\s*/,
		/^\s*\[Thinking\]\s*/,
		/^\s*\[Error\]\s*/,
		/^\s*\[System\]\s*/,
		/^\s*\[Using model: [^\]]+\]\s*/,
		/^\s*\[Output\]\s*/,
		/^\s*\[File [^:]+: [^\]]+\]\s*/,
		/^\s*\[Exit code: [^\]]+\]\s*/,
		/^\s*\[Session started\]\s*/,
	];

	for (const p of prefixes) {
		clean = clean.replace(p, "");
	}

	return clean.trim();
};

const sanitizeLogContent = (content: string, logType?: LogType) => {
	const clean = getCleanContent(content, logType);

	if (!clean) return "_No content_";

	if (logType === "tool_call") {
		return "```json\n" + clean + "\n```";
	}

	if (logType === "tool_result") {
		// If it looks like it already has markdown code fences, leave it.
		if (clean.startsWith("```")) return clean;
		return "```\n" + clean + "\n```";
	}

	return clean;
};

const hasContent = (msg: Message) => {
	return getCleanContent(msg.content, msg.logType).length > 0;
};

const isAlwaysOpen = (msg: Message) => {
	return msg.logType === "system" && hasContent(msg);
};

const loadModelTemplates = async () => {
	try {
		modelTemplates.value = await orpc.listModelTemplates({});
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
	const nextId = match?.id || preferred?.id || modelTemplates.value[0]!.id;
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

const swapModel = async () => {
	const nextId = modelIdDraft.value;
	if (!nextId || nextId === currentModelId.value || isSwappingModel.value)
		return;

	const previousId = currentModelId.value;
	isSwappingModel.value = true;
	// Find model name for the log
	const nextTemplate = modelTemplates.value.find((m) => m.id === nextId);
	const nextName = nextTemplate ? formatModelLabel(nextTemplate) : "next agent";

	// Add handover message
	messages.value.push({
		id: crypto.randomUUID(),
		role: "system",
		content: `Handing over conversation to **${nextName}**...`,
		timestamp: Date.now(),
		logType: "system",
	});
	scrollToBottom();

	// isLoading removed here to prevent spinner during background swap
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
		currentReasoning.value = supportsReasoning.value ? reasoningDraft.value : null;
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
		scrollToBottom();
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

	isUpdatingReasoning.value = true;
	messages.value.push({
		id: crypto.randomUUID(),
		role: "system",
		content: `Updating reasoning to **${formatReasoningLabel(nextReasoning)}**...`,
		timestamp: Date.now(),
		logType: "system",
	});
	scrollToBottom();

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
		scrollToBottom();
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

	isUpdatingMode.value = true;
	messages.value.push({
		id: crypto.randomUUID(),
		role: "system",
		content: `Updating mode to **${formatModeLabel(nextMode)}**...`,
		timestamp: Date.now(),
		logType: "system",
	});
	scrollToBottom();

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
		scrollToBottom();
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

watch(modelIdDraft, async (newVal) => {
	if (newVal && newVal !== currentModelId.value) {
		await swapModel();
	}
});

watch(reasoningDraft, async (newVal) => {
	if (!supportsReasoning.value) return;
	if (newVal === currentReasoning.value) return;
	if (isSwappingModel.value || isUpdatingReasoning.value) return;
	if (isSwappingModel.value || isUpdatingReasoning.value) return;
	await updateReasoning();
});

watch(modeDraft, async (newVal) => {
	if (newVal === currentMode.value) return;
	if (isSwappingModel.value || isUpdatingReasoning.value || isUpdatingMode.value)
		return;
	await updateMode();
});

const appendAgentLog = (payload: AgentLogPayload) => {
	const content = payload.data;
	if (!content.trim()) return;

	// Detect worktree-related changes and refresh branch info
	// This handles cases where the agent creates a worktree and the UI needs to update
	if (
		content.includes("Scheduled resume in worktree") ||
		content.includes("Worktree created") ||
		content.includes("[Agent Manager] Scheduled resume") ||
		content.includes("Switching to worktree")
	) {
		// Refresh branch info after a short delay to allow backend state to update
		setTimeout(() => {
			loadBranchInfo(sessionId.value, projectId.value ?? undefined);
		}, 500);
	}

	// Determine effective type and role for the INCOMING chunk
	const incomingType = payload.type || "text";
	const incomingRole = incomingType === "system" ? "system" : "agent";

	const lastMsg = messages.value[messages.value.length - 1];

	// Check if we can merge
	let merged = false;
	if (lastMsg) {
		// Determine effective type of the LAST message
		const lastType = lastMsg.logType || "text";

		// Strict role match is required
		if (lastMsg.role === incomingRole) {
			// If both are text, merge
			if (incomingType === "text" && lastType === "text") {
				lastMsg.content += content;
				merged = true;
			}
			// If same non-text type (e.g. streaming tool output), merge
			else if (incomingType !== "text" && incomingType === lastType) {
				lastMsg.content += content;
				merged = true;
			}
		}
	}

	if (!merged) {
		// Create new
		messages.value.push({
			id: crypto.randomUUID(),
			role: incomingRole,
			content,
			timestamp: Date.now(),
			logType: incomingType as LogType,
		});
	}

	scrollToBottom();
};

const sendMessage = async () => {
	if (!input.value.trim()) return;

	isLoading.value = true;

	// Check if we need to swap model before sending
	if (modelIdDraft.value && modelIdDraft.value !== currentModelId.value) {
		// If waiting for an in-progress swap (e.g. from watcher), wait for it
		if (isSwappingModel.value) {
			while (isSwappingModel.value) {
				await new Promise((resolve) => setTimeout(resolve, 100));
			}
		} else {
			// Otherwise trigger it explicitly
			await swapModel();
		}

		// If swap failed (draft reverted to previous) or mismatch persists, stop sending
		if (currentModelId.value !== modelIdDraft.value) {
			isLoading.value = false;
			return;
		}
	}

	const messageText = input.value;
	input.value = "";

	// Add user message
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
		// Agent logs will come via event listener
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

const loadBranchInfo = async (sid: string, pid?: string) => {
	try {
		// Pass both sessionId and projectId - backend will prefer sessionId's cwd, fallback to projectId
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
			// Load branch info using sessionId (for agent's cwd) with projectId as fallback
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

// Handle CMD+Enter to submit
const handleKeydown = (e: KeyboardEvent) => {
	if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
		e.preventDefault();
		sendMessage();
	}
};

// Unified initialization logic
async function initSession(id: string) {
	isLoading.value = true;

	sessionId.value = id;
	messages.value = [];
	isMcpSheetOpen.value = false;
	expandedMcpServer.value = null;
	mcpServerTools.value = [];
	// Don't clear title here to prevent flickering - let loadConversation update it
	// conversationTitle.value = ''
	// titleDraft.value = ''

	try {
		await loadConversation(id);
	} finally {
		isLoading.value = false;
		// Wait for 'out-in' transition (approx 100ms) to complete so ScrollArea is in DOM
		setTimeout(async () => {
			await restoreScrollPosition();
		}, 100);
	}
}

// Watch for route param changes
watch(
	() => (route.params as { id: string }).id,
	(newId, oldId) => {
		if (oldId) {
			saveScrollPosition(oldId);
		}
		if (newId) {
			initSession(newId);
		}
	},
);

// Load conversation data and saved messages
async function loadConversation(id: string) {
	try {
		await loadConversationMeta(id);
		// Check if agent is currently running
		const running = await orpc.isAgentRunning({ sessionId: id });
		isGenerating.value = running;

		// Load saved messages from store
		const savedMessages = await orpc.getMessages({ sessionId: id });
		if (savedMessages && savedMessages.length > 0) {
			messages.value = savedMessages.map((m) => ({
				id: m.id,
				role: m.role,
				content: m.content,
				timestamp: m.timestamp,
				logType: m.logType,
			}));
			// Scroll restoration handling moved to initSession finally block
		}
	} catch (err) {
		console.error("Failed to load conversation:", err);
	}
}

const stopGeneration = async () => {
	try {
		await orpc.stopSession({ sessionId: sessionId.value });
	} catch (err) {
		console.error("Failed to stop session:", err);
	}
	isGenerating.value = false;
	isLoading.value = false;
};

const loadMcpServers = async () => {
	isLoadingMcp.value = true;
	try {
		const result = await orpc.getSessionMcpServers({ sessionId: sessionId.value });
		sessionMcpServers.value = result.sessionServers;
		globalMcpServers.value = result.globalServers;
		mcpAgentType.value = result.agentType;
	} catch (err) {
		console.error("Failed to load MCP servers:", err);
	} finally {
		isLoadingMcp.value = false;
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
		if (serverForUi.config && serverForUi.config.url) {
			const url = new URL(serverForUi.config.url);
			url.searchParams.set("superuser", "true");
			serverForUi.config.url = url.toString();
		}
		const result = await orpc.listMcpTools(serverForUi);
		mcpServerTools.value = result;
	} catch (err: any) {
		console.error("Failed to load MCP tools:", err);
		mcpToolsError.value = err.message || "Failed to load tools";
	} finally {
		isLoadingMcpTools.value = false;
	}
};

const isToolDisabled = (server: McpServerEntry, tool: McpTool) => {
	return disabledMcpTools.value.has(`${server.name}-${tool.name}`);
};

const handleToolClick = async (server: McpServerEntry, tool: McpTool) => {
	const key = `${server.name}-${tool.name}`;
	const isCurrentlyDisabled = disabledMcpTools.value.has(key);
	const nextEnabled = isCurrentlyDisabled; // If disabled, we want to enable (true)

	// Optimistic update
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
		// Revert
		if (nextEnabled) {
			disabledMcpTools.value.add(key);
		} else {
			disabledMcpTools.value.delete(key);
		}
	}
};

const toggleMcpServer = (server: McpServerEntry) => {
	const serverKey = `${server.source}-${server.name}`;
	if (expandedMcpServer.value === serverKey) {
		expandedMcpServer.value = null;
		mcpServerTools.value = [];
		mcpToolsError.value = null;
	} else {
		expandedMcpServer.value = serverKey;
		loadMcpServerTools(server);
	}
};

onMounted(async () => {
	await loadModelTemplates();
	// Initialize current session
	await initSession(sessionId.value);

	if (window.electronAPI) {
		isConnected.value = true;

		const handleLog = (payload: AgentLogPayload) => {
			// Filter by sessionId
			if (payload.sessionId === sessionId.value) {
				appendAgentLog(payload);

				// Check for completion signals
				if (payload.type === "system") {
					if (
						payload.data.includes("[Process exited") ||
						payload.data.includes("[Generation stopped")
					) {
						isGenerating.value = false;
						isLoading.value = false;
					}
				}
			}
		};

		const handleStateChanged = (payload: AgentStatePayload) => {
			if (payload.sessionId !== sessionId.value) return;
			const isBusy =
				matchesStateValue(payload.value, "processing") ||
				matchesStateValue(payload.value, "worktreeSwitching") ||
				matchesStateValue(payload.value, "awaitingConfirmation");
			isGenerating.value = isBusy;
		};

		window.electronAPI.onAgentLog(handleLog);
		const removeStatePortListener = onAgentStateChangedPort(handleStateChanged);
		if (!removeStatePortListener) {
			window.electronAPI.onAgentStateChanged(handleStateChanged);
		}
	} else {
		isConnected.value = false;
		messages.value.push({
			id: crypto.randomUUID(),
			role: "system",
			content: "Not in Electron environment. Agent logs will not appear.",
			timestamp: Date.now(),
			logType: "system",
		});
	}
});

watch(modelTemplates, () => {
	applyConversationModelSelection();
});

onBeforeRouteLeave(() => {
	if (sessionId.value) {
		saveScrollPosition(sessionId.value);
	}
});

const formatTime = (timestamp: number) => {
	return new Date(timestamp).toLocaleTimeString([], {
		hour: "2-digit",
		minute: "2-digit",
	});
};
</script>

<template>
  <div class="flex flex-col h-full overflow-hidden bg-background">
    <!-- Header -->
    <div class="border-b px-6 py-3 flex items-center justify-between bg-card/80 backdrop-blur-xl sticky top-0 z-10 shrink-0">
      <div class="flex items-center gap-3">
        <div>
          <input
            v-model="titleDraft"
            class="text-base font-semibold bg-transparent border border-transparent hover:border-input focus:border-input rounded-md px-2 -ml-2 py-1 focus:outline-none focus:ring-1 focus:ring-ring focus:bg-accent/50 transition-all max-w-[320px] truncate"
            placeholder="Session name"
            :disabled="isSavingTitle"
            @blur="saveTitle"
            @keydown.enter.prevent="saveTitle"
          />
          <div class="flex items-center gap-2">
            <div class="flex items-center gap-1.5">
              <span class="size-1.5 rounded-full" :class="isConnected ? 'bg-green-500' : 'bg-red-500'" />
              <span class="text-xs text-muted-foreground">{{ isConnected ? 'Connected' : 'Disconnected' }}</span>
            </div>
            
             <div v-if="currentBranch" class="flex items-center gap-1 px-2 py-0.5 rounded-full bg-accent/50 text-[10px] text-muted-foreground border">
              <GitBranch class="size-3" />
              <span class="font-mono max-w-[150px] truncate">{{ currentBranch }}</span>
            </div>
          </div>
        </div>
      </div>

      <div class="flex items-center gap-2">
        <Button
          variant="ghost"
          size="icon"
          class="h-8 w-8 text-muted-foreground"
          :class="{ 'bg-accent text-accent-foreground': isMcpSheetOpen }"
          @click="toggleMcpSheet"
          title="View MCP Servers"
        >
          <Plug class="size-4" />
        </Button>
      </div>
    </div>

    <ResizablePanelGroup :key="isMcpSheetOpen ? 'open' : 'closed'" direction="horizontal" class="flex-1 min-h-0">
      <ResizablePanel :default-size="isMcpSheetOpen ? 80 : 100" :min-size="30">
        <div class="flex flex-col h-full min-w-0">
        <!-- Messages Area -->
        <ScrollArea class="flex-1 min-h-0" ref="scrollAreaRef">
          <div class="flex flex-col gap-2 p-4 max-w-3xl mx-auto">
            <div v-if="messages.length === 0" class="flex flex-col items-center justify-center py-20 text-center">
              <div class="size-12 rounded-full bg-muted flex items-center justify-center mb-4">
                <Sparkles class="size-6 text-muted-foreground" />
              </div>
              <h3 class="font-semibold text-lg mb-2">Start a conversation</h3>
              <p class="text-sm text-muted-foreground max-w-sm">
                Send a message to start working with your agent.
              </p>
            </div>

            <div v-for="msg in messages" :key="msg.id">
              <!-- Type 1: Standard Chat Balloon (User or Agent 'text') -->
              <div 
                v-if="msg.role === 'user' || (msg.role === 'agent' && (!msg.logType || msg.logType === 'text'))"
                class="group flex gap-4 my-4" 
                :class="{ 'flex-row-reverse': msg.role === 'user' }"
              >
                <!-- Avatar -->
                <Avatar class="size-8 shrink-0 border" :class="msg.role === 'agent' ? 'bg-primary/10' : 'bg-muted'">
                  <div v-if="msg.role === 'agent'" class="flex items-center justify-center size-full text-primary font-semibold text-xs">AI</div>
                  <div v-else class="flex items-center justify-center size-full text-muted-foreground font-semibold text-xs">You</div>
                </Avatar>

                <!-- Message Content -->
                <div class="flex flex-col gap-1 min-w-0 max-w-[85%]" :class="{ 'items-end': msg.role === 'user' }">
                  <div class="flex items-center gap-2 px-1">
                    <span class="text-xs font-medium text-muted-foreground">
                      {{ msg.role === 'agent' ? 'Agent' : 'You' }}
                    </span>
                    <span class="text-[10px] text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity">
                      {{ formatTime(msg.timestamp) }}
                    </span>
                  </div>
                  <div 
                    class="relative bg-card border rounded-2xl px-4 py-3 shadow-sm markdown-content"
                    :class="{
                      'rounded-tr-md': msg.role === 'user',
                      'rounded-tl-md': msg.role === 'agent',
                    }"
                  >
                    <div v-html="renderMarkdown(msg.content)" />
                    
                    <!-- Copy Button -->
                    <button 
                      @click.stop="copyMessage(msg.content, msg.id)"
                      class="absolute top-2 right-2 size-7 rounded-lg bg-background/80 border opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center hover:bg-muted"
                    >
                      <Check v-if="copiedId === msg.id" class="size-3.5 text-green-500" />
                      <Copy v-else class="size-3.5 text-muted-foreground" />
                    </button>
                  </div>
                </div>
              </div>

              <!-- Type 2: System / Tool / Thinking Log (Minimal Timeline Style) -->
              <div v-else class="flex flex-col gap-0.5 py-0.5 px-4 group">
                 <!-- Header -->
                <div 
                  @click="!isAlwaysOpen(msg) && hasContent(msg) && toggleMessage(msg.id)"
                  class="flex items-center gap-2 select-none px-2 py-1.5 rounded-md transition-colors opacity-80 hover:opacity-100"
                  :class="!isAlwaysOpen(msg) && hasContent(msg) ? 'cursor-pointer hover:bg-black/5 dark:hover:bg-white/5' : 'cursor-default'"
                >
                  <!-- Spacer if always open or empty, Chevron otherwise -->
                  <div v-if="isAlwaysOpen(msg) || !hasContent(msg)" class="size-3.5" /> 
                  <component 
                    v-else
                    :is="expandedMessageIds.has(msg.id) ? ChevronDown : ChevronRight" 
                    class="size-3.5 opacity-50 shrink-0"
                  />
                  
                  <!-- Icon based on type -->
                  <Terminal v-if="msg.logType === 'tool_call' || msg.logType === 'tool_result'" class="size-3.5 text-blue-500 shrink-0" />
                  <AlertCircle v-else-if="msg.logType === 'error'" class="size-3.5 text-red-500 shrink-0" />
                  <Sparkles v-else-if="msg.logType === 'thinking'" class="size-3.5 text-purple-500 shrink-0" />
                  <Cpu v-else-if="msg.logType === 'system'" class="size-3.5 text-green-500 shrink-0" />
                  <AlertCircle v-else class="size-3.5 text-yellow-500 shrink-0" />

                  <span class="text-xs font-medium font-mono text-muted-foreground truncate max-w-[200px]">
                    {{ getLogSummary(msg) }}
                  </span>
                  
                   <!-- Timestamp (faint) -->
                   <span class="ml-auto text-[10px] text-muted-foreground/40">{{ formatTime(msg.timestamp) }}</span>
                </div>

                <!-- Content (Visible if always open OR manually expanded) -->
                <div 
                  v-show="isAlwaysOpen(msg) || expandedMessageIds.has(msg.id)"
                  class="pl-8 pr-2 pb-2"
                >
                  <div class="relative bg-muted/30 border rounded-md px-3 py-2 text-sm markdown-content">
                    <div v-html="renderMarkdown(sanitizeLogContent(msg.content, msg.logType))" />
                    
                     <!-- Copy Button (Small) -->
                    <button 
                      @click.stop="copyMessage(sanitizeLogContent(msg.content, msg.logType), msg.id)"
                      class="absolute top-2 right-2 size-6 rounded bg-background/50 border opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center hover:bg-background"
                    >
                      <Check v-if="copiedId === msg.id" class="size-3 text-green-500" />
                      <Copy v-else class="size-3 text-muted-foreground" />
                    </button>
                  </div>
                </div>
              </div>
            </div>

            <!-- Typing Indicator (shown when waiting for response) -->
            <div v-if="isGenerating" class="flex gap-4">
              <Avatar class="size-8 shrink-0 border bg-primary/10">
                <div class="flex items-center justify-center size-full text-primary font-semibold text-xs">AI</div>
              </Avatar>
              <div class="bg-card border rounded-2xl rounded-tl-md px-4 py-3 shadow-sm">
                <div class="flex items-center gap-1">
                  <span class="size-2 bg-muted-foreground/40 rounded-full animate-bounce" style="animation-delay: 0ms" />
                  <span class="size-2 bg-muted-foreground/40 rounded-full animate-bounce" style="animation-delay: 150ms" />
                  <span class="size-2 bg-muted-foreground/40 rounded-full animate-bounce" style="animation-delay: 300ms" />
                </div>
              </div>
            </div>

            <!-- Scroll target -->
            <div ref="messagesEndRef" class="h-px" />
          </div>
        </ScrollArea>
        
        <!-- Input Area -->
        <div class="border-t bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 shrink-0">
          <div class="max-w-3xl mx-auto p-4 flex flex-col gap-2">
            <form @submit.prevent="sendMessage">
              <div class="flex items-center gap-2">
                <div class="flex-1 bg-card rounded-2xl border shadow-sm focus-within:ring-2 focus-within:ring-ring focus-within:border-transparent transition-all">
                  <Textarea 
                    v-model="input" 
                    placeholder="Send a message..." 
                    class="min-h-[56px] max-h-[200px] py-3 px-4 bg-transparent border-0 focus-visible:ring-0 resize-none shadow-none text-sm"
                    :disabled="isLoading"
                    @keydown="handleKeydown"
                    autofocus
                  />
                </div>
                
                <!-- Stop Button (shown when generating) -->
                <Button 
                  v-if="isGenerating"
                  type="button"
                  size="icon"
                  @click="stopGeneration"
                  class="h-11 w-11 shrink-0 rounded-xl bg-red-600 hover:bg-red-700 shadow-lg shadow-red-600/20 transition-all text-white border-0"
                >
                  <Square class="size-5 fill-current" />
                </Button>
                
                <!-- Send Button (shown when not generating) -->
                <Button 
                  v-else
                  type="submit" 
                  size="icon"
                  class="h-11 w-11 shrink-0 rounded-xl bg-blue-600 hover:bg-blue-700 shadow-lg shadow-blue-600/20 transition-all text-white border-0"
                  :class="{ 'opacity-50 cursor-not-allowed': !input.trim() || isLoading }"
                  :disabled="!input.trim() || isLoading"
                >
                  <Loader2 v-if="isLoading" class="size-5 animate-spin" />
                  <Send v-else class="size-5" />
                </Button>
              </div>

              <div class="flex items-center justify-between mt-2 px-1">
                 <!-- Selectors Group -->
                 <div class="flex items-center gap-2">
                     <!-- Model Selector -->
                     <div class="relative min-w-[120px]">
                       <select
                         v-model="modelIdDraft"
                         class="h-6 w-auto min-w-[140px] rounded-md border border-input bg-transparent px-2 text-[10px] shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 appearance-none pr-6 cursor-pointer hover:bg-accent/50"
                         :disabled="isUpdatingAgent || isLoading || modelTemplates.length === 0"
                       >
                         <option v-for="m in modelTemplates" :key="m.id" :value="m.id">
                           {{ formatModelLabel(m) }}
                         </option>
                       </select>
                       <div class="pointer-events-none absolute inset-y-0 right-0 gap-1 px-2 flex items-center text-muted-foreground">
                         <Loader2 v-if="isSwappingModel" class="size-2.5 animate-spin" />
                         <ChevronDown class="size-3" />
                       </div>
                     </div>

                  <!-- Mode Selector (Planning) -->
                  <div class="relative min-w-[80px]">
                      <select
                        v-model="modeDraft"
                        class="h-6 w-auto min-w-[80px] rounded-md border border-input bg-transparent px-2 text-[10px] shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 appearance-none pr-6 cursor-pointer hover:bg-accent/50"
                        :disabled="isUpdatingAgent || isLoading"
                      >
                        <option v-for="option in modeOptions" :key="option.value" :value="option.value">
                          {{ option.label }}
                        </option>
                      </select>
                      <div class="pointer-events-none absolute inset-y-0 right-0 gap-1 px-2 flex items-center text-muted-foreground">
                         <Loader2 v-if="isUpdatingMode" class="size-2.5 animate-spin" />
                        <ChevronDown class="size-3" />
                      </div>
                    </div>

                    <!-- Reasoning Selector -->
                    <div v-if="supportsReasoning" class="relative min-w-[110px]">
                       <select
                         v-model="reasoningDraft"
                         class="h-6 w-auto min-w-[110px] rounded-md border border-input bg-transparent px-2 text-[10px] shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 appearance-none pr-6 cursor-pointer hover:bg-accent/50"
                         :disabled="isUpdatingAgent || isLoading"
                       >
                         <option v-for="option in reasoningOptions" :key="option.value" :value="option.value">
                           {{ option.label }}
                         </option>
                       </select>
                       <div class="pointer-events-none absolute inset-y-0 right-0 gap-1 px-2 flex items-center text-muted-foreground">
                          <Loader2 v-if="isUpdatingReasoning" class="size-2.5 animate-spin" />
                         <ChevronDown class="size-3" />
                       </div>
                     </div>
                 </div>

                <p class="text-[10px] text-muted-foreground">
                  Press <kbd class="px-1 py-0.5 rounded bg-muted text-[9px] font-mono">⌘</kbd> + <kbd class="px-1 py-0.5 rounded bg-muted text-[9px] font-mono">Enter</kbd> to send
                </p>
              </div>
            </form>
          </div>
        </div>
        </div>
      </ResizablePanel>
    
      <ResizableHandle v-if="isMcpSheetOpen" />

      <!-- MCP Sidebar -->
      <Transition name="sidebar">
        <ResizablePanel 
          v-if="isMcpSheetOpen"
          :default-size="20"
          :min-size="10"
          class="bg-background flex flex-col min-w-[250px] max-w-[30vw] overflow-hidden"
        >
          <div class="h-12 border-b px-4 flex items-center justify-between shrink-0">
          <div class="flex items-center gap-2 font-semibold text-sm">
            <Plug class="size-4" />
            MCP Servers
            <Badge v-if="mcpAgentType" variant="outline" class="text-[10px] h-5 ml-1">
              {{ mcpAgentType }}
            </Badge>
          </div>
          <Button variant="ghost" size="icon" class="size-7" @click="isMcpSheetOpen = false">
            <X class="size-4" />
          </Button>
        </div>
        
        <ScrollArea class="flex-1 min-h-0 h-full">
          <div class="p-4 space-y-6">
            <div v-if="isLoadingMcp" class="flex items-center justify-center py-8">
              <Loader2 class="size-6 animate-spin text-muted-foreground" />
            </div>

            <template v-else>
              <!-- Session-specific (Injected) MCP Servers -->
              <div>
                <h3 class="text-sm font-semibold mb-3 flex items-center gap-2">
                  <Server class="size-4 text-primary" />
                  Injected Servers
                </h3>
                <div v-if="sessionMcpServers.length === 0" class="text-sm text-muted-foreground italic pl-6">
                  No injected servers for this session.
                </div>
                <div v-else class="space-y-2">
                  <div
                    v-for="server in sessionMcpServers"
                    :key="`session-${server.name}`"
                    class="p-3 rounded-lg border bg-card cursor-pointer hover:border-primary/50 transition-colors"
                    @click="toggleMcpServer(server)"
                  >
                    <div class="flex items-center justify-between">
                      <div class="flex items-center gap-2">
                        <component 
                          :is="expandedMcpServer === `${server.source}-${server.name}` ? ChevronDown : ChevronRight" 
                          class="size-3.5 text-muted-foreground"
                        />
                        <span class="font-medium text-sm">{{ server.name }}</span>
                      </div>
                      <Badge variant="secondary" class="text-xs">
                        {{ server.config.url ? (server.config.type || 'HTTP') : 'stdio' }}
                      </Badge>
                    </div>
                    <p class="text-xs text-muted-foreground mt-1 font-mono truncate pl-5">
                      {{ getMcpConnectionInfo(server) }}
                    </p>

                    <!-- Tools List -->
                    <Transition name="accordion">
                    <div v-if="expandedMcpServer === `${server.source}-${server.name}`" class="mt-3 border-primary/20 space-y-2 py-1" @click.stop>
                      <div v-if="isLoadingMcpTools" class="flex items-center gap-2 py-2">
                        <Loader2 class="size-3 animate-spin text-muted-foreground" />
                        <span class="text-xs text-muted-foreground">Loading tools...</span>
                      </div>
                      <div v-else-if="mcpToolsError" class="text-xs text-red-500 py-2">
                        {{ mcpToolsError }}
                      </div>
                      <div v-else-if="mcpServerTools.length === 0" class="text-xs text-muted-foreground py-2 italic">
                        No tools found.
                      </div>
                      <div v-else class="grid gap-2">
                        <div 
                          v-for="tool in mcpServerTools" 
                          :key="tool.name" 
                          class="group/tool bg-muted/20 rounded p-2 border border-transparent hover:border-border transition-colors cursor-pointer select-none"
                          :class="{ 'opacity-50 grayscale': isToolDisabled(server, tool) }"
                          @click="handleToolClick(server, tool)"
                        >
                          <div class="flex items-center justify-between gap-2 overflow-hidden">
                            <span class="text-xs font-mono font-bold text-primary truncate" :title="tool.name">{{ tool.name }}</span>
                          </div>
                          <p v-if="tool.description" class="text-[10px] text-muted-foreground mt-1 line-clamp-2">
                            {{ tool.description }}
                          </p>
                        </div>
                      </div>
                    </div>
                    </Transition>
                  </div>
                </div>
              </div>

              <!-- General (Global) MCP Servers -->
              <div>
                <h3 class="text-sm font-semibold mb-3 flex items-center gap-2">
                  <Terminal class="size-4 text-primary" />
                  Global Servers
                </h3>
                <div v-if="globalMcpServers.length === 0" class="text-sm text-muted-foreground italic pl-6">
                  No global servers configured.
                </div>
                <div v-else class="space-y-2">
                  <div
                    v-for="server in globalMcpServers"
                    :key="`global-${server.name}`"
                    class="p-3 rounded-lg border bg-muted/30 cursor-pointer hover:border-primary/50 transition-colors"
                    @click="toggleMcpServer(server)"
                  >
                    <div class="flex items-center justify-between">
                      <div class="flex items-center gap-2">
                        <component 
                          :is="expandedMcpServer === `${server.source}-${server.name}` ? ChevronDown : ChevronRight" 
                          class="size-3.5 text-muted-foreground"
                        />
                        <span class="font-medium text-sm">{{ server.name }}</span>
                      </div>
                      <Badge variant="outline" class="text-xs">
                        {{ server.config.url ? (server.config.type || 'HTTP') : 'stdio' }}
                      </Badge>
                    </div>
                    <p class="text-xs text-muted-foreground mt-1 font-mono truncate pl-5">
                      {{ getMcpConnectionInfo(server) }}
                    </p>

                    <!-- Tools List -->
                    <Transition name="accordion">
                    <div v-if="expandedMcpServer === `${server.source}-${server.name}`" class="mt-3 space-y-2 py-1" @click.stop>
                      <div v-if="isLoadingMcpTools" class="flex items-center gap-2 py-2">
                        <Loader2 class="size-3 animate-spin text-muted-foreground" />
                        <span class="text-xs text-muted-foreground">Loading tools...</span>
                      </div>
                      <div v-else-if="mcpToolsError" class="text-xs text-red-500 py-2">
                        {{ mcpToolsError }}
                      </div>
                      <div v-else-if="mcpServerTools.length === 0" class="text-xs text-muted-foreground py-2 italic">
                        No tools found.
                      </div>
                      <div v-else class="grid gap-2">
                        <div v-for="tool in mcpServerTools" :key="tool.name" class="group/tool bg-muted/20 rounded p-2 border border-transparent hover:border-border transition-colors">
                          <div class="flex items-center justify-between gap-2 overflow-hidden">
                            <span class="text-xs font-mono font-bold text-primary truncate" :title="tool.name">{{ tool.name }}</span>
                          </div>
                          <p v-if="tool.description" class="text-[10px] text-muted-foreground mt-1 line-clamp-2">
                            {{ tool.description }}
                          </p>
                        </div>
                      </div>
                    </div>
                    </Transition>
                  </div>
                </div>
              </div>
            </template>

            <!-- Future Feature Note -->
            <div class="p-3 rounded-lg border border-dashed bg-muted/20 text-xs text-muted-foreground">
              <strong>Coming Soon:</strong> Enable/disable MCP servers per conversation.
            </div>
          </div>
        </ScrollArea>
      </ResizablePanel>
      </Transition>
    </ResizablePanelGroup>
  </div>
</template>

<style scoped>
.sidebar-enter-active,
.sidebar-leave-active {
  transition: all 0.3s ease-in-out;
  overflow: hidden;
}

.sidebar-enter-from,
.sidebar-leave-to {
  flex-grow: 0.00001 !important;
  min-width: 0 !important;
  max-width: 0 !important;
  opacity: 0;
  transform: translateX(20px);
}

.accordion-enter-active,
.accordion-leave-active {
  transition: all 0.3s ease-in-out;
  max-height: 1000px;
  overflow: hidden;
}

.accordion-enter-from,
.accordion-leave-to {
  max-height: 0;
  opacity: 0;
  padding-top: 0;
  padding-bottom: 0;
  margin-top: 0;
  border: none;
}
</style>
