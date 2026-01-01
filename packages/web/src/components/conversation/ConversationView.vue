<script setup lang="ts">
import type {
	AgentLogPayload,
	AgentMode,
	AgentStatePayload,
	ReasoningLevel,
} from "@agent-manager/shared";
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import { useRoute } from "vue-router";
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
import { groupModelTemplates } from "@/lib/modelTemplateGroups";
import { onAgentStateChangedPort } from "@/services/agent-state-port";
import { orpc } from "@/services/orpc";

const props = defineProps<{
  sessionId: string;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
}>();

const route = useRoute();
const projects = ref<{ id: string; name: string }[]>([]);

const getQueryProjectId = () => {
	const value = route.query.projectId;
	if (Array.isArray(value)) return value[0];
	if (typeof value === "string") return value;
	return undefined;
};

const selectNewConversationProject = () => {
	if (conversation.sessionId.value !== "new") return;

	const requestedProjectId = getQueryProjectId();
	const isValidProject = (value?: string | null) =>
		!!value && projects.value.some((p) => p.id === value);

	if (requestedProjectId && isValidProject(requestedProjectId)) {
		conversation.projectId.value = requestedProjectId;
		return;
	}

	if (!isValidProject(conversation.projectId.value)) {
		conversation.projectId.value = projects.value[0]?.id ?? null;
	}
};

const loadProjects = async () => {
	try {
		projects.value = await orpc.listProjects({});
		selectNewConversationProject();
	} catch (e) {
		console.error("Failed to list projects", e);
	}
};

const conversation = useConversation(props.sessionId);

const groupedModelTemplates = computed(() =>
	groupModelTemplates(conversation.modelTemplates.value),
);

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

// Scroll handling
type ScrollAreaInstance = InstanceType<typeof ScrollArea> & {
	$el?: HTMLElement;
};
const scrollAreaRef = ref<ScrollAreaInstance | null>(null);
const messagesEndRef = ref<HTMLElement | null>(null);

const getScrollViewport = () => {
	if (!scrollAreaRef.value) return null;
	const el = scrollAreaRef.value.$el;

	if (!el) return null;

	return (
		el.querySelector<HTMLElement>("[data-radix-scroll-area-viewport]") ?? null
	);
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
    if (conversation.sessionId.value === id && conversation.messages.value.length > 0) {
        return;
    }
    
	conversation.isLoading.value = true;
	conversation.sessionId.value = id;
	conversation.messages.value = [];
	conversation.isMcpSheetOpen.value = false;
	conversation.expandedMcpServer.value = null;
	conversation.mcpServerTools.value = [];
	if (id === "new") {
		conversation.projectId.value = null;
		selectNewConversationProject();
	}

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

watch(
	() => route.query.projectId,
	() => {
		selectNewConversationProject();
	},
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
    loadProjects();
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
	<div class="conversation-view flex flex-col h-full overflow-hidden bg-background">
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
				<Transition name="viewer-fade" mode="out-in">
					<div :key="props.sessionId" class="flex flex-col h-full min-w-0">
						<!-- Messages Area -->
						<ScrollArea class="flex-1 min-h-0" ref="scrollAreaRef">
							<div v-if="conversation.sessionId.value === 'new'" class="h-full flex flex-col items-center justify-center text-muted-foreground p-8 text-center">
								<!-- New Session Setup UI -->
								<div class="space-y-6 w-full text-left max-w-3xl p-4">
                                <h3 class="text-xl font-semibold text-foreground">Start a new conversation</h3>
                                
                                <div class="flex flex-col gap-4">
                                  <label class="text-sm font-medium w-16">Project :</label>
                                     <div class="flex items-center justify-between gap-4">
                                         <select 
                                            :value="conversation.projectId.value || ''"
										 @change="conversation.projectId.value = ($event.target as HTMLSelectElement).value"
										 class="h-9 flex-1 rounded-md border border-input bg-background px-3 py-1 text-sm text-foreground shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
									  >
                                            <option v-for="p in projects" :key="p.id" :value="p.id">
                                                {{ p.name }}
                                            </option>
                                         </select>
                                     </div>
                                  <label class="text-sm font-medium w-16">Agents :</label>
                                  <div class="flex items-center justify-between gap-4">
                                    <select
                                      :value="conversation.modelIdDraft.value"
									 @change="
									 	conversation.modelIdDraft.value = ($event.target as HTMLSelectElement).value
									 "
									 class="h-9 flex-1 rounded-md border border-input bg-background px-3 py-1 text-sm text-foreground shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
									 :disabled="conversation.isUpdatingAgent.value || conversation.isLoading.value || conversation.modelTemplates.value.length === 0"
								 >
                                      <optgroup
                                        v-for="group in groupedModelTemplates"
                                        :key="group.agentType + (group.isCustomApi ? '-custom' : '-default')"
                                        :label="group.label"
                                      >
                                        <option v-for="m in group.models" :key="m.id" :value="m.id">
                                          {{ m.name }}
                                        </option>
                                      </optgroup>
                                    </select>
                                  </div>
                                  <template v-if="conversation.supportsReasoning.value">
                                    <label class="text-sm font-medium w-16">Reasoning :</label>
                                    <div class="flex items-center justify-between gap-4">
                                      <select
                                        :value="conversation.reasoningDraft.value"
										 @change="
										 	conversation.reasoningDraft.value = ($event.target as HTMLSelectElement).value as ReasoningLevel
										 "
										class="h-9 flex-1 rounded-md border border-input bg-background px-3 py-1 text-sm text-foreground shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
										:disabled="conversation.isUpdatingAgent.value || conversation.isLoading.value"
									  >
                                        <option v-for="option in reasoningOptions" :key="option.value" :value="option.value">
                                          {{ option.label }}
                                        </option>
                                      </select>
                                    </div>
                                  </template>
                                  <label class="text-sm font-medium w-16">Mode :</label>
                                  <div class="flex items-center justify-between gap-4">
                                    <select
										 :value="conversation.modeDraft.value"
										 @change="conversation.modeDraft.value = ($event.target as HTMLSelectElement).value as AgentMode"
										class="h-9 flex-1 rounded-md border border-input bg-background px-3 py-1 text-sm text-foreground shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
										:disabled="conversation.isUpdatingAgent.value || conversation.isLoading.value"
									>
                                      <option v-for="option in modeOptions" :key="option.value" :value="option.value">
                                        {{ option.label }}
                                      </option>
                                    </select>
                                  </div>

                                </div>
                                <p class="text-sm">Type your message below to begin.</p>
                            </div>
                        </div>

							<ChatMessageList
								v-else
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
            :isSelectorDisabled="conversation.sessionId.value === 'new' || conversation.isGenerating.value || conversation.isLoading.value"
						@update:input="conversation.input.value = $event"
						@update:model-id-draft="conversation.modelIdDraft.value = $event"
						@update:mode-draft="conversation.modeDraft.value = $event"
						@update:reasoning-draft="conversation.reasoningDraft.value = $event"
						@send="handleSendMessage"
						@stop="handleStopGeneration"
					/>
				</div></Transition>
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

.viewer-fade-enter-active,
.viewer-fade-leave-active {
	transition: opacity 220ms ease;
}

.viewer-fade-enter-from,
.viewer-fade-leave-to {
	opacity: 0;
}
</style>
