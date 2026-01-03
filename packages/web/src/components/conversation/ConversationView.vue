<script setup lang="ts">
import type {
	AgentLogPayload,
	AgentMode,
	AgentStatePayload,
	ReasoningLevel,
} from "@agent-manager/shared";
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import ChatInput from "@/components/conversation/ChatInput.vue";
import ChatMessageList from "@/components/conversation/ChatMessageList.vue";
import ConversationHeader from "@/components/conversation/ConversationHeader.vue";
import McpSidebar from "@/components/conversation/McpSidebar.vue";
import {
	ResizableHandle,
	ResizablePanel,
	ResizablePanelGroup,
} from "@/components/ui/resizable";
import { ScrollArea } from "@/components/ui/scroll-area";
import PlanViewer from "@/components/plan/PlanViewer.vue";
import { useConversationStore } from "@/stores/conversation";
import { useProjectsStore } from "@/stores/projects";
import { groupModelTemplates } from "@/lib/modelTemplateGroups";
import { onAgentStateChangedPort } from "@/services/agent-state-port";

const props = defineProps<{
  sessionId: string;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
}>();

const route = useRoute();
const router = useRouter();
const projectsStore = useProjectsStore();
const conversation = useConversationStore();

const getQueryProjectId = () => {
	const value = route.query.projectId;
	if (Array.isArray(value)) return value[0];
	if (typeof value === "string") return value;
	return undefined;
};

const selectNewConversationProject = () => {
	if (conversation.sessionId !== "new") return;

	const requestedProjectId = getQueryProjectId();
	const isValidProject = (value?: string | null) =>
		!!value && projectsStore.projects.some((p) => p.id === value);

	if (requestedProjectId && isValidProject(requestedProjectId)) {
		conversation.projectId = requestedProjectId;
		return;
	}

	if (!isValidProject(conversation.projectId)) {
		conversation.projectId = projectsStore.projects[0]?.id ?? null;
	}
};

const loadProjects = async () => {
	await projectsStore.loadProjects();
	selectNewConversationProject();
};

const groupedModelTemplates = computed(() =>
	groupModelTemplates(conversation.modelTemplates),
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

	return el.querySelector("[data-radix-scroll-area-viewport]") as HTMLElement | null;
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
	const key = `scroll-pos-${conversation.sessionId}`;
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
    if (conversation.sessionId === id && conversation.messages.length > 0) {
        return;
    }
    
    conversation.initSession(id);

	if (id === "new") {
		conversation.projectId = null;
		selectNewConversationProject();
	}

	try {
        conversation.isLoading = true;
		await conversation.loadConversation(id);
	} finally {
		conversation.isLoading = false;
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
const handleSendMessage = async () => {
	const isNew = props.sessionId === "new";
	await conversation.sendMessage(scrollToBottom);
	scrollToBottom();

	if (isNew && conversation.sessionId !== "new") {
		router.replace(`/conversions/${conversation.sessionId}`);
	}
};

const handleStopGeneration = async () => {
	await conversation.stopGeneration();
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
		conversation.isConnected = true;

		const handleLog = (payload: AgentLogPayload) => {
			if (payload.sessionId === conversation.sessionId) {
				conversation.appendAgentLog(payload);
				scrollToBottom();

				if (payload.type === "system") {
					if (
						payload.data.includes("[Process exited") ||
						payload.data.includes("[Generation stopped")
					) {
						conversation.isGenerating = false;
						conversation.isLoading = false;
					}
				}
			}
		};

		const handleStateChanged = (payload: AgentStatePayload) => {
			if (payload.sessionId !== conversation.sessionId) return;
			const isBusy =
				conversation.matchesStateValue(payload.value, "processing") ||
				conversation.matchesStateValue(payload.value, "worktreeSwitching") ||
				conversation.matchesStateValue(payload.value, "awaitingConfirmation");
			conversation.isGenerating = isBusy;
		};

		const logListenerResult = window.electronAPI.onAgentLog(handleLog);
		if (typeof logListenerResult === "function") {
			removeLogListener = logListenerResult;
		}
		const removeStatePortListener = onAgentStateChangedPort(handleStateChanged);
		if (!removeStatePortListener) {
			const stateListenerResult = window.electronAPI.onAgentStateChanged(handleStateChanged);
			if (typeof stateListenerResult === "function") {
				removeStateListener = stateListenerResult;
			}
		} else {
            removeStateListener = removeStatePortListener;
        }
	} else {
		conversation.isConnected = false;
		conversation.messages.push({
			id: crypto.randomUUID(),
			role: "system",
			content: "Not in Electron environment. Agent logs will not appear.",
			timestamp: Date.now(),
			logType: "system",
		});
	}
});

onUnmounted(() => {
    if (conversation.sessionId) {
		saveScrollPosition(conversation.sessionId);
	}
    if (removeLogListener) removeLogListener();
    if (removeStateListener) removeStateListener();
});
</script>

<template>
	<div class="conversation-view flex flex-col h-full overflow-hidden bg-background">
		<!-- Header (no props needed) -->
		<ConversationHeader />

		<ResizablePanelGroup
			:key="conversation.isMcpSheetOpen ? 'open' : 'closed'"
			direction="horizontal"
			class="flex-1 min-h-0"
		>
			<ResizablePanel
				:default-size="conversation.isMcpSheetOpen ? 80 : 100"
				:min-size="30"
			>
				<Transition name="viewer-fade" mode="out-in">
					<div :key="props.sessionId" class="flex flex-col h-full min-w-0">
						<!-- Messages Area -->
						<ScrollArea class="flex-1 min-h-0" ref="scrollAreaRef">
							<div v-if="conversation.sessionId === 'new'" class="h-full flex flex-col items-center justify-center text-muted-foreground p-8 text-center">
								<!-- New Session Setup UI -->
								<div class="space-y-6 w-full text-left max-w-3xl p-4">
                                <h3 class="text-xl font-semibold text-foreground">Start a new conversation</h3>
                                
                                <div class="flex flex-col gap-4">
                                  <label class="text-sm font-medium w-16">Project :</label>
                                     <div class="flex items-center justify-between gap-4">
                                         <select 
                                            :value="conversation.projectId || ''"
										 @change="conversation.projectId = ($event.target as HTMLSelectElement).value"
										 class="h-9 flex-1 rounded-md border border-input bg-background px-3 py-1 text-sm text-foreground shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
									  >
                                            <option v-for="p in projectsStore.projects" :key="p.id" :value="p.id">
                                                {{ p.name }}
                                            </option>
                                         </select>
                                     </div>
                                  <label class="text-sm font-medium w-16">Agents :</label>
                                  <div class="flex items-center justify-between gap-4">
                                    <select
                                      :value="conversation.modelIdDraft"
									 @change="
									 	conversation.modelIdDraft = ($event.target as HTMLSelectElement).value
									 "
									 class="h-9 flex-1 rounded-md border border-input bg-background px-3 py-1 text-sm text-foreground shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
									 :disabled="conversation.isUpdatingAgent || conversation.isLoading || conversation.modelTemplates.length === 0"
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
                                  <template v-if="conversation.supportsReasoning">
                                    <label class="text-sm font-medium w-16">Reasoning :</label>
                                    <div class="flex items-center justify-between gap-4">
                                      <select
                                        :value="conversation.reasoningDraft"
									 @change="
									 	conversation.reasoningDraft = ($event.target as HTMLSelectElement).value as ReasoningLevel
									 "
									class="h-9 flex-1 rounded-md border border-input bg-background px-3 py-1 text-sm text-foreground shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
									:disabled="conversation.isUpdatingAgent || conversation.isLoading"
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
									 :value="conversation.modeDraft"
									 @change="conversation.modeDraft = ($event.target as HTMLSelectElement).value as AgentMode"
									class="h-9 flex-1 rounded-md border border-input bg-background px-3 py-1 text-sm text-foreground shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
									:disabled="conversation.isUpdatingAgent || conversation.isLoading"
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

							<!-- ChatMessageList (no props needed) -->
							<ChatMessageList v-else />
							<div ref="messagesEndRef" class="h-px" />
						</ScrollArea>

					<!-- ChatInput (only emits for actions) -->
					<ChatInput
						@send="handleSendMessage"
						@stop="handleStopGeneration"
					/>
				</div></Transition>
			</ResizablePanel>

			<ResizableHandle v-if="conversation.isMcpSheetOpen || conversation.isPlanViewerOpen" />

			<!-- MCP Sidebar (no props needed) -->
			<Transition name="sidebar">
				<ResizablePanel
					v-if="conversation.isMcpSheetOpen"
					:default-size="20"
					:min-size="10"
					class="bg-background flex flex-col min-w-[250px] max-w-[30vw] overflow-hidden"
				>
					<McpSidebar />
				</ResizablePanel>
			</Transition>

			<!-- Plan Viewer Sidebar (no props needed) -->
			<Transition name="sidebar">
				<ResizablePanel
					v-if="conversation.isPlanViewerOpen"
					:default-size="30"
					:min-size="20"
					class="bg-background flex flex-col min-w-[300px] max-w-[45vw] overflow-hidden"
				>
					<PlanViewer />
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
