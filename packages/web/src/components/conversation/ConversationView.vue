<script setup lang="ts">
import type {
	AgentMode,
	AgentStatePayload,
	ReasoningLevel,
	SessionEvent,
} from "@agent-manager/shared";
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import ChatInput from "@/components/conversation/ChatInput.vue";
import ChatMessageList from "@/components/conversation/ChatMessageList.vue";
import ConversationHeader from "@/components/conversation/ConversationHeader.vue";
import McpSidebar from "@/components/conversation/McpSidebar.vue";
import PlanViewer from "@/components/plan/PlanViewer.vue";
import {
	ResizableHandle,
	ResizablePanel,
	ResizablePanelGroup,
} from "@/components/ui/resizable";
import { ScrollArea } from "@/components/ui/scroll-area";
import { groupModelTemplates } from "@/lib/modelTemplateGroups";
import { orpc } from "@/services/orpc";
import { useConversationStore } from "@/stores/conversation";
import { useProjectsStore } from "@/stores/projects";

const props = defineProps<{
	sessionId: string;
}>();

const emit = defineEmits<(e: "close") => void>();

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

const isSessionReady = ref(false);
const isInitializingSession = ref(false);

// Session initialization
async function initSession(id: string) {
	// Prevent duplicate concurrent calls
	if (isInitializingSession.value) {
		return;
	}
	if (conversation.sessionId === id && conversation.messages.length > 0) {
		return;
	}

	isInitializingSession.value = true;
	conversation.initSession(id);
	isSessionReady.value = false;

	if (id === "new") {
		conversation.projectId = null;
		selectNewConversationProject();
	}

	try {
		conversation.isLoading = true;
		await conversation.loadConversation(id);
	} finally {
		conversation.isLoading = false;
		isInitializingSession.value = false;
		setTimeout(() => {
			isSessionReady.value = true;
		}, 100);
	}
}

// Watch for sessionId changes
watch(
	() => props.sessionId,
	(newId) => {
		if (newId) {
			void initSession(newId);
		}
	},
	{ immediate: true },
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
	await conversation.sendMessage(() => {});

	if (isNew && conversation.sessionId !== "new") {
		router.replace(`/conversions/${conversation.sessionId}`);
	}
};

const handleStopGeneration = async () => {
	await conversation.stopGeneration();
};

// Mounted setup
onMounted(async () => {
	loadProjects();
	await conversation.loadModelTemplates();
	conversation.setupWatchers();
	// Note: initSession is called by watch with immediate: true, so we don't call it here again

	// Handle typed SessionEvent from the main process.
	const handleSessionEvent = (event: SessionEvent) => {
		if (event.sessionId !== conversation.sessionId) return;

		switch (event.type) {
			case "log":
				conversation.appendAgentLog(event.payload);
				// Handle generation end detection from log content
				if (event.payload.type === "system") {
					if (
						event.payload.data.includes("[Process exited") ||
						event.payload.data.includes("[Generation stopped")
					) {
						conversation.isGenerating = false;
						conversation.isLoading = false;
					}
				}
				break;

			case "state-change": {
				const isBusy =
					conversation.matchesStateValue(event.payload.value, "processing") ||
					conversation.matchesStateValue(
						event.payload.value,
						"worktreeSwitching",
					) ||
					conversation.matchesStateValue(
						event.payload.value,
						"awaitingConfirmation",
					);
				conversation.isGenerating = isBusy;
				break;
			}

			case "session-lifecycle":
				if (event.payload.action === "started") {
					conversation.isGenerating = true;
				} else if (
					event.payload.action === "stopped" ||
					event.payload.action === "reset"
				) {
					conversation.isGenerating = false;
					conversation.isLoading = false;
				}
				break;

			case "tool-call":
				conversation.addToolCall(event.payload);
				break;
			case "tool-result":
				conversation.addToolResult(event.payload);
				break;
			case "thinking":
				conversation.addThinking(event.payload);
				break;
			case "error":
				conversation.addError(event.payload);
				break;
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

	// Set up oRPC subscriptions
	const setupSubscriptions = async () => {
		try {
			// 1. Session Events
			const eventIterator = await orpc.electron.agent.subscribeEvents({});
			(async () => {
				try {
					for await (const event of eventIterator) {
						handleSessionEvent(event);
					}
				} catch (err) {
					console.error("Agent event subscription error:", err);
				}
			})();

			// 2. State Changes
			const stateIterator = await orpc.electron.agent.subscribeState({});
			(async () => {
				try {
					for await (const payload of stateIterator) {
						handleStateChanged(payload);
					}
				} catch (err) {
					console.error("Agent state subscription error:", err);
				}
			})();

			conversation.isConnected = true;
		} catch (err) {
			console.error("Failed to setup agent subscriptions:", err);
			conversation.isConnected = false;
			conversation.messages.push({
				id: crypto.randomUUID(),
				role: "system",
				content:
					"Failed to connect to agent backend. Agent logs will not appear.",
				timestamp: Date.now(),
				logType: "system",
			});
		}
	};

	void setupSubscriptions();
});

onUnmounted(() => {
	// oRPC subscriptions are aborted when the component unmounts or browser context changes?
	// Actually, oRPC iterators typically need an abort signal to stop.
	// Since we didn't pass one, they might leak until connection close.
	// Ideally we should pass an AbortSignal to subscribeEvents/subscribeState if supported,
	// or rely on component unmount to naturally sever if the link supports it.
	// With MessagePort, closing the port would do it, but we share the client.
	// For now, we rely on the implementation detail that these are global streams or
	// we should implement proper cleanup if the store/component lifecycle demands it.
	// Given the context of a "View", these are likely meant to persist or be one-off.
});
</script>

<template>
	<div
		class="conversation-view flex flex-col h-full overflow-hidden bg-background"
	>
		<!-- Header (no props needed) -->
		<ConversationHeader/>

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
						<div class="relative flex-1 min-h-0">
							<!-- New Session Setup UI -->
							<ScrollArea
								v-if="conversation.sessionId === 'new'"
								class="h-full w-full"
							>
								<div
									class="h-full flex flex-col items-center justify-center text-muted-foreground p-8 text-center"
								>
									<div class="space-y-6 w-full text-left max-w-3xl p-4">
										<h3 class="text-xl font-semibold text-foreground">
											Start a new conversation
										</h3>

										<div class="flex flex-col gap-4">
											<label class="text-sm font-medium w-16">Project :</label>
											<div class="flex items-center justify-between gap-4">
												<select
													:value="conversation.projectId || ''"
													@change="conversation.projectId = ($event.target as HTMLSelectElement).value"
													class="h-9 flex-1 rounded-md border border-input bg-background px-3 py-1 text-sm text-foreground shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
												>
													<option
														v-for="p in projectsStore.projects"
														:key="p.id"
														:value="p.id"
													>
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
														<option
															v-for="m in group.models"
															:key="m.id"
															:value="m.id"
														>
															{{ m.name }}
														</option>
													</optgroup>
												</select>
											</div>
											<template v-if="conversation.supportsReasoning">
												<label class="text-sm font-medium w-16">
													Reasoning :
												</label>
												<div class="flex items-center justify-between gap-4">
													<select
														:value="conversation.reasoningDraft"
														@change="
									 	conversation.reasoningDraft = ($event.target as HTMLSelectElement).value as ReasoningLevel
									 "
														class="h-9 flex-1 rounded-md border border-input bg-background px-3 py-1 text-sm text-foreground shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
														:disabled="conversation.isUpdatingAgent || conversation.isLoading"
													>
														<option
															v-for="option in reasoningOptions"
															:key="option.value"
															:value="option.value"
														>
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
													<option
														v-for="option in modeOptions"
														:key="option.value"
														:value="option.value"
													>
														{{ option.label }}
													</option>
												</select>
											</div>
										</div>
										<p class="text-sm">Type your message below to begin.</p>
									</div>
								</div>
							</ScrollArea>

							<!-- ChatMessageList with TanStack Virtual -->
							<ChatMessageList
								v-else
								class="h-full w-full transition-opacity duration-150"
								:class="isSessionReady ? 'opacity-100' : 'opacity-0'"
							/>
						</div>

						<!-- ChatInput (only emits for actions) -->
						<ChatInput @send="handleSendMessage" @stop="handleStopGeneration"/>
					</div>
				</Transition>
			</ResizablePanel>

			<ResizableHandle
				v-if="conversation.isMcpSheetOpen || conversation.isPlanViewerOpen"
			/>

			<!-- MCP Sidebar (no props needed) -->
			<Transition name="sidebar">
				<ResizablePanel
					v-if="conversation.isMcpSheetOpen"
					:default-size="20"
					:min-size="10"
					class="bg-background flex flex-col min-w-[250px] max-w-[30vw] overflow-hidden"
				>
					<McpSidebar/>
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
					<PlanViewer/>
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
	flex-grow: 0.00001;
	min-width: 0;
	max-width: 0;
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
