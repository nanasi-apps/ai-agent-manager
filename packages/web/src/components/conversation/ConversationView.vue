<script setup lang="ts">
import type { AgentLogPayload, AgentStatePayload } from "@agent-manager/shared";
import { nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import {
	ChatInput,
	ChatMessageList,
	ConversationHeader,
	McpSidebar,
} from "@/components/conversation";
import {
	ResizableHandle,
	ResizablePanel,
	ResizablePanelGroup,
} from "@/components/ui/resizable";
import { ScrollArea } from "@/components/ui/scroll-area";
import PlanViewer from "@/components/plan/PlanViewer.vue";
import { useConversation } from "@/composables/useConversation";
import { onAgentStateChangedPort } from "@/services/agent-state-port";

const props = defineProps<{
  sessionId: string;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
}>();

const conversation = useConversation(props.sessionId);

// Scroll handling
const scrollAreaRef = ref<InstanceType<typeof ScrollArea> | null>(null);
const messagesEndRef = ref<HTMLElement | null>(null);

const getScrollViewport = () => {
	if (!scrollAreaRef.value) return null;
	const component = scrollAreaRef.value as any;
	const el = (component.$el || component) as HTMLElement;

	if (!el || typeof el.querySelector !== "function") return null;

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
	const key = `scroll-pos-${conversation.sessionId.value}`;
	const saved = sessionStorage.getItem(key);

	if (saved !== null) {
		const viewport = getScrollViewport();
		if (viewport) {
			viewport.scrollTop = parseInt(saved, 10);
			return;
		}
	}

	await scrollToBottom(false);
};

const scrollToBottom = async (smooth = true) => {
	await nextTick();

	if (messagesEndRef.value) {
		messagesEndRef.value.scrollIntoView({
			behavior: smooth ? "smooth" : "instant",
		});
		return;
	}

	const viewport = getScrollViewport();

	if (viewport) {
		if (smooth) {
			viewport.scrollTo({ top: viewport.scrollHeight, behavior: "smooth" });
		} else {
			viewport.scrollTop = viewport.scrollHeight;
		}
	}
};

// Session initialization
async function initSession(id: string) {
	conversation.isLoading.value = true;
	conversation.sessionId.value = id;
	conversation.messages.value = [];
	conversation.isMcpSheetOpen.value = false;
	conversation.expandedMcpServer.value = null;
	conversation.mcpServerTools.value = [];

	try {
		await conversation.loadConversation(id);
	} finally {
		conversation.isLoading.value = false;
		setTimeout(async () => {
			await restoreScrollPosition();
		}, 100);
	}
}

// Watch for sessionId changes
watch(
	() => props.sessionId,
	(newId, oldId) => {
		if (oldId) {
			saveScrollPosition(oldId);
		}
		if (newId) {
			initSession(newId);
		}
	},
    { immediate: true }
);

// Event handlers
const handleCopyMessage = async (content: string, id: string) => {
	await conversation.copyMessage(content, id);
};

const handleToggleMessage = (id: string) => {
	conversation.toggleMessage(id);
};

const handleSendMessage = async () => {
	await conversation.sendMessage(scrollToBottom);
	scrollToBottom();
};

const handleStopGeneration = async () => {
	await conversation.stopGeneration();
};

const handleSaveTitle = async () => {
	await conversation.saveTitle();
};

const handleToggleMcp = () => {
	conversation.toggleMcpSheet();
};

const handleCloseMcp = () => {
	conversation.isMcpSheetOpen.value = false;
};

const handleToggleMcpServer = (server: any) => {
	conversation.toggleMcpServer(server);
};

const handleToggleMcpTool = async (server: any, tool: any) => {
	await conversation.handleToolClick(server, tool);
};

const handleApprovePlan = async (modelId: string) => {
	await conversation.approvePlan(modelId);
	scrollToBottom();
};

// Mounted setup
let removeLogListener: (() => void) | undefined;
let removeStateListener: (() => void) | undefined;

onMounted(async () => {
	await conversation.loadModelTemplates();
	conversation.setupWatchers();
	await initSession(props.sessionId);

	if (window.electronAPI) {
		conversation.isConnected.value = true;

		const handleLog = (payload: AgentLogPayload) => {
			if (payload.sessionId === conversation.sessionId.value) {
				conversation.appendAgentLog(payload);
				scrollToBottom();

				if (payload.type === "system") {
					if (
						payload.data.includes("[Process exited") ||
						payload.data.includes("[Generation stopped")
					) {
						conversation.isGenerating.value = false;
						conversation.isLoading.value = false;
					}
				}
			}
		};

		const handleStateChanged = (payload: AgentStatePayload) => {
			if (payload.sessionId !== conversation.sessionId.value) return;
			const isBusy =
				conversation.matchesStateValue(payload.value, "processing") ||
				conversation.matchesStateValue(payload.value, "worktreeSwitching") ||
				conversation.matchesStateValue(payload.value, "awaitingConfirmation");
			conversation.isGenerating.value = isBusy;
		};

		removeLogListener = window.electronAPI.onAgentLog(handleLog);
		const removeStatePortListener = onAgentStateChangedPort(handleStateChanged);
		if (!removeStatePortListener) {
            removeStateListener = window.electronAPI.onAgentStateChanged(handleStateChanged);
		} else {
            removeStateListener = removeStatePortListener;
        }
	} else {
		conversation.isConnected.value = false;
		conversation.messages.value.push({
			id: crypto.randomUUID(),
			role: "system",
			content: "Not in Electron environment. Agent logs will not appear.",
			timestamp: Date.now(),
			logType: "system",
		});
	}
});

onUnmounted(() => {
    if (conversation.sessionId.value) {
		saveScrollPosition(conversation.sessionId.value);
	}
    if (removeLogListener) removeLogListener();
    if (removeStateListener) removeStateListener();
});
</script>

<template>
	<div class="flex flex-col h-full overflow-hidden bg-background">
		<!-- Header -->
		<ConversationHeader
			:title-draft="conversation.titleDraft.value"
			:is-saving-title="conversation.isSavingTitle.value"
			:is-connected="conversation.isConnected.value"
			:current-branch="conversation.currentBranch.value"
			:is-mcp-sheet-open="conversation.isMcpSheetOpen.value"
			:is-plan-viewer-open="conversation.isPlanViewerOpen.value"
			@update:title-draft="conversation.titleDraft.value = $event"
			@save-title="handleSaveTitle"
			@toggle-mcp="handleToggleMcp"
			@toggle-plan-viewer="conversation.togglePlanViewer"
		/>

		<ResizablePanelGroup
			:key="conversation.isMcpSheetOpen.value ? 'open' : 'closed'"
			direction="horizontal"
			class="flex-1 min-h-0"
		>
			<ResizablePanel
				:default-size="conversation.isMcpSheetOpen.value ? 80 : 100"
				:min-size="30"
			>
				<div class="flex flex-col h-full min-w-0">
					<!-- Messages Area -->
					<ScrollArea class="flex-1 min-h-0" ref="scrollAreaRef">
						<ChatMessageList
							:messages="conversation.messages.value"
							:is-generating="conversation.isGenerating.value"
							:copied-id="conversation.copiedId.value"
							:expanded-message-ids="conversation.expandedMessageIds.value"
							:current-model="conversation.selectedModelTemplate.value"
							@copy="handleCopyMessage"
							@toggle="handleToggleMessage"
						/>
						<div ref="messagesEndRef" class="h-px" />
					</ScrollArea>

					<!-- Input Area -->
					<ChatInput
						:input="conversation.input.value"
						:is-loading="conversation.isLoading.value"
						:is-generating="conversation.isGenerating.value"
						:is-updating-agent="conversation.isUpdatingAgent.value"
						:model-templates="conversation.modelTemplates.value"
						:model-id-draft="conversation.modelIdDraft.value"
						:mode-draft="conversation.modeDraft.value"
						:reasoning-draft="conversation.reasoningDraft.value"
						:is-swapping-model="conversation.isSwappingModel.value"
						:is-updating-mode="conversation.isUpdatingMode.value"
						:is-updating-reasoning="conversation.isUpdatingReasoning.value"
						:supports-reasoning="conversation.supportsReasoning.value"
						@update:input="conversation.input.value = $event"
						@update:model-id-draft="conversation.modelIdDraft.value = $event"
						@update:mode-draft="conversation.modeDraft.value = $event"
						@update:reasoning-draft="conversation.reasoningDraft.value = $event"
						@send="handleSendMessage"
						@stop="handleStopGeneration"
					/>
				</div>
			</ResizablePanel>

			<ResizableHandle v-if="conversation.isMcpSheetOpen.value || conversation.isPlanViewerOpen.value" />

			<!-- MCP Sidebar -->
			<Transition name="sidebar">
				<ResizablePanel
					v-if="conversation.isMcpSheetOpen.value"
					:default-size="20"
					:min-size="10"
					class="bg-background flex flex-col min-w-[250px] max-w-[30vw] overflow-hidden"
				>
					<McpSidebar
						:is-open="conversation.isMcpSheetOpen.value"
						:is-loading="conversation.isLoadingMcp.value"
						:session-servers="conversation.sessionMcpServers.value"
						:global-servers="conversation.globalMcpServers.value"
						:agent-type="conversation.mcpAgentType.value"
						:expanded-server="conversation.expandedMcpServer.value"
						:server-tools="conversation.mcpServerTools.value"
						:is-loading-tools="conversation.isLoadingMcpTools.value"
						:tools-error="conversation.mcpToolsError.value"
						:disabled-tools="conversation.disabledMcpTools.value"
						@close="handleCloseMcp"
						@toggle-server="handleToggleMcpServer"
						@toggle-tool="handleToggleMcpTool"
					/>
				</ResizablePanel>
			</Transition>

			<!-- Plan Viewer Sidebar -->
			<Transition name="sidebar">
				<ResizablePanel
					v-if="conversation.isPlanViewerOpen.value"
					:default-size="30"
					:min-size="20"
					class="bg-background flex flex-col min-w-[300px] max-w-[45vw] overflow-hidden"
				>
					<PlanViewer
						:content="conversation.latestPlanContent.value"
						:is-open="conversation.isPlanViewerOpen.value"
						:model-templates="conversation.modelTemplates.value"
						:is-approving="conversation.isApproving.value"
						@close="conversation.togglePlanViewer"
						@approve="handleApprovePlan"
					/>
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
</style>
