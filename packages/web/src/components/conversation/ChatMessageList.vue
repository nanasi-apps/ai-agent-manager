<script setup lang="ts">
import { useVirtualizer } from "@tanstack/vue-virtual";
import {
	AlertCircle,
	ArrowDown,
	Check,
	ChevronDown,
	ChevronRight,
	Copy,
	Cpu,
	FileText,
	Sparkles,
	Terminal,
} from "lucide-vue-next";
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { Avatar } from "@/components/ui/avatar";
import { renderMarkdown } from "@/lib/markdown";
import {
	type LogType,
	type Message,
	useConversationStore,
} from "@/stores/conversation";

const { t } = useI18n();
const conversation = useConversationStore();

// Scroll container ref
const scrollContainerRef = ref<HTMLDivElement | null>(null);

type LogGroup = {
	id: string;
	timestamp: number;
	logs: Message[];
};

type DisplayItem =
	| { type: "message"; message: Message }
	| { type: "log-group"; group: LogGroup };

type GroupTitleDetails = {
	title: string;
	sourceType: "thinking" | "tool_call" | "fallback" | "system";
	sourceLogId?: string;
};

const codexLogTypes = new Set<LogType>([
	"thinking",
	"tool_call",
	"tool_result",
]);

const getAgentLabel = () => {
	const currentModel = conversation.selectedModelTemplate;
	if (!currentModel) return t("chat.agent");

	const modelName = currentModel.model || currentModel.name;
	const agentName = currentModel.agentName;

	if (modelName && agentName) {
		return `${modelName} - ${agentName}`;
	}
	return agentName || t("chat.agent");
};

const getLogSummary = (msg: Message) => {
	const content = msg.content || "";
	const type = msg.logType;

	if (type === "system") {
		const modelMatch = content.match(/\[Using model: ([^\]]+)\]/);
		if (modelMatch) return `Model: ${modelMatch[1]}`;
		return "System";
	}

	return type;
};

const getCodexLogLabel = (msg: Message) => {
	const content = msg.content || "";

	if (msg.logType === "thinking") {
		return `${t("chat.thinking")}...`;
	}

	if (msg.logType === "tool_call") {
		const toolMatch = content.match(/\[Tool: ([^\]]+)\]/);
		if (toolMatch) return `${t("chat.toolCall")}: ${toolMatch[1]}`;
		const execMatch = content.match(/\[Executing: ([^\]]+)\]/);
		if (execMatch) return `${t("chat.toolCall")}: ${execMatch[1]}`;
		return t("chat.toolCall");
	}

	if (msg.logType === "tool_result") {
		const resultMatch = content.match(/\[Result: ([^\]]+)\]/);
		if (resultMatch) return `${t("chat.toolResult")}: ${resultMatch[1]}`;
		if (content.includes("[Output]")) return t("chat.output");
		if (content.includes("[File ")) return t("chat.fileChange");
		return t("chat.toolResult");
	}

	return getLogSummary(msg);
};

const getCleanContent = (content: string, logType?: LogType) => {
	if (!logType || logType === "text") return content.trim();

	let clean = content;
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

	if (!clean) return "No content";

	if (logType === "tool_call") {
		return `\`\`\`json\n${clean}\n\`\`\``;
	}

	if (logType === "tool_result") {
		if (clean.startsWith("```")) return clean;
		return `\`\`\`\n${clean}\n\`\`\``;
	}

	return clean;
};

const hasContent = (msg: Message) => {
	return getCleanContent(msg.content, msg.logType).length > 0;
};

const isAlwaysOpen = (msg: Message) => {
	return (
		(msg.logType === "system" || msg.logType === "error") && hasContent(msg)
	);
};

const isGroupLogAlwaysOpen = (msg: Message) => {
	if (!msg.logType) return false;
	if (msg.logType === "thinking") return true;
	return msg.logType === "system" || msg.logType === "error";
};

const isThinkingLog = (logType?: LogType) => logType === "thinking";

const getGroupTitleDetails = (group: LogGroup): GroupTitleDetails => {
	const thinkingLog = group.logs.find((log) => log.logType === "thinking");
	if (thinkingLog) {
		return {
			title: t("chat.thinking"),
			sourceType: "thinking",
			sourceLogId: thinkingLog.id,
		};
	}

	const toolLog = group.logs.find((log) => log.logType === "tool_call");
	if (toolLog) {
		return {
			title: t("chat.toolCall"),
			sourceType: "tool_call",
			sourceLogId: toolLog.id,
		};
	}

	const fallback = group.logs.find((log) => log.logType);
	if (fallback) {
		return {
			title: t("chat.system"),
			sourceType: "fallback",
			sourceLogId: fallback.id,
		};
	}

	return { title: t("chat.system"), sourceType: "system" };
};

const getGroupSummary = (group: LogGroup) => getGroupTitleDetails(group).title;

const shouldHideGroupLogTitle = (log: Message, group: LogGroup) => {
	const details = getGroupTitleDetails(group);
	return details.sourceType === "tool_call" && details.sourceLogId === log.id;
};

const formatTime = (timestamp: number) => {
	return new Date(timestamp).toLocaleTimeString([], {
		hour: "2-digit",
		minute: "2-digit",
	});
};

const shouldGroupLogs = true;

const displayItems = computed<DisplayItem[]>(() => {
	const items: DisplayItem[] = [];
	const messages = conversation.messages;

	for (let i = 0; i < messages.length; i++) {
		const msg = messages[i];
		if (!msg) continue;
		const logType = msg.logType;

		if (
			shouldGroupLogs &&
			msg.role === "agent" &&
			logType &&
			codexLogTypes.has(logType)
		) {
			const logs: Message[] = [];
			let cursor = i;

			while (cursor < messages.length) {
				const current = messages[cursor];
				if (!current) break;
				const currentType = current.logType;
				if (
					current.role !== "agent" ||
					!currentType ||
					!codexLogTypes.has(currentType)
				) {
					break;
				}
				if (cursor !== i && currentType === "thinking") {
					break;
				}
				logs.push(current);
				cursor += 1;
			}

			items.push({
				type: "log-group",
				group: {
					id: `log-group-${logs[0]?.id}`,
					timestamp: logs[0]?.timestamp ?? msg.timestamp,
					logs,
				},
			});
			i = cursor - 1;
			continue;
		}

		items.push({ type: "message", message: msg });
	}

	return items;
});

// TanStack Virtual setup
const ESTIMATED_ITEM_HEIGHT = 120;

const virtualizer = useVirtualizer({
	get count() {
		// Add 1 for typing indicator when generating
		return displayItems.value.length + (conversation.isGenerating ? 1 : 0);
	},
	getScrollElement: () => scrollContainerRef.value,
	estimateSize: () => ESTIMATED_ITEM_HEIGHT,
	overscan: 3,
});

const virtualItems = computed(() => virtualizer.value.getVirtualItems());
const totalSize = computed(() => virtualizer.value.getTotalSize());

// Track expanded states to recalculate sizes
watch(
	() => [...conversation.expandedMessageIds],
	() => {
		// Re-measure all items when expand states change
		nextTick(() => {
			virtualizer.value.measure();
		});
	},
);

// Auto-scroll to bottom when new messages arrive or content updates
const isAutoScrollEnabled = ref(true);
const lastMessageCount = ref(0);
const lastContentLength = ref(0);

// Scroll to bottom helper
const scrollToBottom = (smooth = true) => {
	if (!isAutoScrollEnabled.value) return;

	nextTick(() => {
		const itemCount =
			displayItems.value.length + (conversation.isGenerating ? 1 : 0);
		if (itemCount > 0) {
			virtualizer.value.scrollToIndex(itemCount - 1, {
				align: "end",
				behavior: smooth ? "smooth" : "auto",
			});
		}
	});
};

// Watch for new messages
watch(
	() => conversation.messages.length,
	(newCount) => {
		if (newCount > lastMessageCount.value) {
			scrollToBottom();
		}
		lastMessageCount.value = newCount;
	},
);

// Watch for content updates in last message (streaming)
watch(
	() => {
		const lastMsg = conversation.messages[conversation.messages.length - 1];
		return lastMsg?.content?.length ?? 0;
	},
	(newLength) => {
		if (newLength > lastContentLength.value && isAutoScrollEnabled.value) {
			// Use instant scroll for streaming to avoid jank
			scrollToBottom(false);
		}
		lastContentLength.value = newLength;
	},
);

// Watch for typing indicator changes
watch(
	() => conversation.isGenerating,
	(isGenerating) => {
		if (isGenerating) {
			scrollToBottom();
		}
	},
);

// Scroll event handling for auto-scroll toggle
const handleScroll = () => {
	const el = scrollContainerRef.value;
	if (!el) return;

	const threshold = 150;
	const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
	isAutoScrollEnabled.value = distanceFromBottom <= threshold;
};

onMounted(() => {
	scrollContainerRef.value?.addEventListener("scroll", handleScroll, {
		passive: true,
	});
	// Initial scroll to bottom
	scrollToBottom(false);
});

onUnmounted(() => {
	scrollContainerRef.value?.removeEventListener("scroll", handleScroll);
});

const handleCopy = async (content: string, id: string) => {
	await conversation.copyMessage(content, id);
};

const handleToggle = (id: string) => {
	conversation.toggleMessage(id);
};

const handleLogClick = (msg: Message) => {
	if (msg.logType === "plan") {
		conversation.isPlanViewerOpen = true;
		return;
	}
	if (!isAlwaysOpen(msg) && hasContent(msg)) {
		handleToggle(msg.id);
	}
};

// Force scroll to bottom (for button click)
const forceScrollToBottom = () => {
	isAutoScrollEnabled.value = true;
	scrollToBottom(true);
};

// Get item data by virtual index
const getItemByIndex = (
	index: number,
): DisplayItem | { type: "typing-indicator" } | null => {
	if (index < displayItems.value.length) {
		return displayItems.value[index]!;
	}
	if (index === displayItems.value.length && conversation.isGenerating) {
		return { type: "typing-indicator" };
	}
	return null;
};
</script>

<template>
	<div ref="scrollContainerRef" class="h-full w-full overflow-auto">
		<div class="relative w-full" :style="{ height: `${totalSize}px` }">
			<div
				v-if="conversation.messages.length === 0 && !conversation.isGenerating"
				class="absolute inset-0 flex flex-col items-center justify-center py-20 text-center"
			>
				<div
					class="size-12 rounded-full bg-muted flex items-center justify-center mb-4"
				>
					<Sparkles class="size-6 text-muted-foreground"/>
				</div>
				<h3 class="font-semibold text-lg mb-2">
					{{ t('chat.startConversation') }}
				</h3>
				<p class="text-sm text-muted-foreground max-w-sm">
					{{ t('chat.startPrompt') }}
				</p>
			</div>

			<div
				v-for="virtualRow in virtualItems"
				:key="String(virtualRow.key)"
				:ref="(el) => {
					if (el) virtualizer.measureElement(el as HTMLElement)
				}"
				:data-index="virtualRow.index"
				class="absolute top-0 left-1/2 -translate-x-1/2 w-full p-4 max-w-3xl"
				:style="{ transform: `translateY(${virtualRow.start}px)` }"
			>
				<!-- Typing Indicator -->
				<template
					v-if="getItemByIndex(virtualRow.index)?.type === 'typing-indicator'"
				>
					<div class="flex gap-4">
						<Avatar class="size-8 shrink-0 border bg-primary/10">
							<div
								class="flex items-center justify-center size-full text-primary font-semibold text-xs"
							>
								AI
							</div>
						</Avatar>
						<div
							class="bg-card border rounded-2xl rounded-tl-md px-4 py-3 shadow-sm"
						>
							<div class="flex items-center gap-1">
								<span
									class="size-2 bg-muted-foreground/40 rounded-full animate-bounce"
									style="animation-delay: 0ms"
								/>
								<span
									class="size-2 bg-muted-foreground/40 rounded-full animate-bounce"
									style="animation-delay: 150ms"
								/>
								<span
									class="size-2 bg-muted-foreground/40 rounded-full animate-bounce"
									style="animation-delay: 300ms"
								/>
							</div>
						</div>
					</div>
				</template>

				<!-- Regular Message or Log Group -->
				<template v-else-if="getItemByIndex(virtualRow.index)">
					<template v-if="getItemByIndex(virtualRow.index)!.type === 'message'">
						<!-- Type 1: Standard Chat Balloon (User or Agent 'text') -->
						<div
							v-if="
								(getItemByIndex(virtualRow.index) as { type: 'message'; message: Message }).message.role === 'user' ||
								((getItemByIndex(virtualRow.index) as { type: 'message'; message: Message }).message.role === 'agent' &&
									(!(getItemByIndex(virtualRow.index) as { type: 'message'; message: Message }).message.logType || (getItemByIndex(virtualRow.index) as { type: 'message'; message: Message }).message.logType === 'text'))
							"
							class="group flex gap-4"
							:class="{ 'flex-row-reverse': (getItemByIndex(virtualRow.index) as { type: 'message'; message: Message }).message.role === 'user' }"
						>
							<!-- Avatar -->
							<Avatar
								class="size-8 shrink-0 border"
								:class="
									(getItemByIndex(virtualRow.index) as { type: 'message'; message: Message }).message.role === 'agent' ? 'bg-primary/10' : 'bg-muted'
								"
							>
								<div
									v-if="(getItemByIndex(virtualRow.index) as { type: 'message'; message: Message }).message.role === 'agent'"
									class="flex items-center justify-center size-full text-primary font-semibold text-xs"
								>
									AI
								</div>
								<div
									v-else
									class="flex items-center justify-center size-full text-muted-foreground font-semibold text-xs"
								>
									{{ t('chat.you') }}
								</div>
							</Avatar>

							<!-- Message Content -->
							<div
								class="flex flex-col gap-1 min-w-0 max-w-[85%]"
								:class="{ 'items-end': (getItemByIndex(virtualRow.index) as { type: 'message'; message: Message }).message.role === 'user' }"
							>
								<div class="flex items-center gap-2 px-1">
									<span class="text-xs font-medium text-muted-foreground">
										{{
											(getItemByIndex(virtualRow.index) as { type: 'message'; message: Message }).message.role === "agent"
												? getAgentLabel()
												: t('chat.you')
										}}
									</span>
									<span
										class="text-[10px] text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity"
									>
										{{ formatTime((getItemByIndex(virtualRow.index) as { type: 'message'; message: Message }).message.timestamp) }}
									</span>
								</div>
								<div
									class="relative bg-card border rounded-2xl px-4 py-3 shadow-sm markdown-content overflow-hidden"
									:class="{
										'rounded-tr-md': (getItemByIndex(virtualRow.index) as { type: 'message'; message: Message }).message.role === 'user',
										'rounded-tl-md': (getItemByIndex(virtualRow.index) as { type: 'message'; message: Message }).message.role === 'agent',
									}"
								>
									<div
										v-html="renderMarkdown((getItemByIndex(virtualRow.index) as { type: 'message'; message: Message }).message.content)"
									/>

									<!-- Copy Button -->
									<button
										@click.stop="handleCopy((getItemByIndex(virtualRow.index) as { type: 'message'; message: Message }).message.content, (getItemByIndex(virtualRow.index) as { type: 'message'; message: Message }).message.id)"
										class="absolute top-2 right-2 size-7 rounded-lg bg-background/80 border opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center hover:bg-muted"
									>
										<Check
											v-if="conversation.copiedId === (getItemByIndex(virtualRow.index) as { type: 'message'; message: Message }).message.id"
											class="size-3.5 text-green-500"
										/>
										<Copy v-else class="size-3.5 text-muted-foreground"/>
									</button>
								</div>
							</div>
						</div>

						<!-- Type 2: System / Tool / Thinking Log (Minimal Timeline Style) -->
						<div v-else class="flex flex-col gap-0.5 py-0.5 px-4 group">
							<!-- Header -->
							<div
								@click="handleLogClick((getItemByIndex(virtualRow.index) as { type: 'message'; message: Message }).message)"
								class="flex items-center gap-2 select-none px-2 py-1.5 rounded-md transition-colors opacity-80 hover:opacity-100"
								:class="
									(getItemByIndex(virtualRow.index) as { type: 'message'; message: Message }).message.logType === 'plan' || (!isAlwaysOpen((getItemByIndex(virtualRow.index) as { type: 'message'; message: Message }).message) && hasContent((getItemByIndex(virtualRow.index) as { type: 'message'; message: Message }).message))
											? 'cursor-pointer hover:bg-black/5 dark:hover:bg-white/5'
												: 'cursor-default'
								"
							>
								<!-- Spacer if always open or empty, Chevron otherwise -->
								<div
									v-if="isAlwaysOpen((getItemByIndex(virtualRow.index) as { type: 'message'; message: Message }).message) || !hasContent((getItemByIndex(virtualRow.index) as { type: 'message'; message: Message }).message)"
									class="size-3.5"
								/>
								<component
									v-else
									:is="
										conversation.expandedMessageIds.has((getItemByIndex(virtualRow.index) as { type: 'message'; message: Message }).message.id)
											? ChevronDown
											: ChevronRight
									"
									class="size-3.5 opacity-50 shrink-0"
								/>

								<!-- Icon based on type -->
								<Terminal
									v-if="
										(getItemByIndex(virtualRow.index) as { type: 'message'; message: Message }).message.logType === 'tool_call' ||
										(getItemByIndex(virtualRow.index) as { type: 'message'; message: Message }).message.logType === 'tool_result'
									"
									class="size-3.5 text-blue-500 shrink-0"
								/>
								<AlertCircle
									v-else-if="(getItemByIndex(virtualRow.index) as { type: 'message'; message: Message }).message.logType === 'error'"
									class="size-3.5 text-red-500 shrink-0"
								/>
								<Sparkles
									v-else-if="(getItemByIndex(virtualRow.index) as { type: 'message'; message: Message }).message.logType === 'thinking'"
									class="size-3.5 text-purple-500 shrink-0"
								/>
								<Cpu
									v-else-if="(getItemByIndex(virtualRow.index) as { type: 'message'; message: Message }).message.logType === 'system'"
									class="size-3.5 text-green-500 shrink-0"
								/>
								<FileText
									v-else-if="(getItemByIndex(virtualRow.index) as { type: 'message'; message: Message }).message.logType === 'plan'"
									class="size-3.5 text-orange-500 shrink-0"
								/>
								<AlertCircle v-else class="size-3.5 text-yellow-500 shrink-0"/>

								<span
									class="text-xs font-medium font-mono text-muted-foreground truncate max-w-[200px]"
								>
									{{ getLogSummary((getItemByIndex(virtualRow.index) as { type: 'message'; message: Message }).message) }}
								</span>

								<!-- Timestamp (faint) -->
								<span class="ml-auto text-[10px] text-muted-foreground/40"
									>{{
									formatTime((getItemByIndex(virtualRow.index) as { type: 'message'; message: Message }).message.timestamp)
								}}</span
								>
							</div>

							<!-- Content (Visible if always open OR manually expanded) -->
							<div
								v-show="
									isAlwaysOpen((getItemByIndex(virtualRow.index) as { type: 'message'; message: Message }).message) ||
									conversation.expandedMessageIds.has((getItemByIndex(virtualRow.index) as { type: 'message'; message: Message }).message.id)
								"
								class="pl-8 pr-2 pb-2"
							>
								<div
									class="relative bg-muted/30 border rounded-md px-3 py-2 text-sm markdown-content overflow-hidden"
								>
									<div
										v-html="
											renderMarkdown(
												sanitizeLogContent((getItemByIndex(virtualRow.index) as { type: 'message'; message: Message }).message.content, (getItemByIndex(virtualRow.index) as { type: 'message'; message: Message }).message.logType),
											)
										"
									/>

									<!-- Copy Button (Small) -->
									<button
										@click.stop="
											handleCopy(
												sanitizeLogContent(
													(getItemByIndex(virtualRow.index) as { type: 'message'; message: Message }).message.content,
													(getItemByIndex(virtualRow.index) as { type: 'message'; message: Message }).message.logType,
												),
												(getItemByIndex(virtualRow.index) as { type: 'message'; message: Message }).message.id,
											)
										"
										class="absolute top-2 right-2 size-6 rounded bg-background/50 border opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center hover:bg-background"
									>
										<Check
											v-if="conversation.copiedId === (getItemByIndex(virtualRow.index) as { type: 'message'; message: Message }).message.id"
											class="size-3 text-green-500"
										/>
										<Copy v-else class="size-3 text-muted-foreground"/>
									</button>
								</div>
							</div>
						</div>
					</template>

					<!-- Group Thinking + Tool Calls into one message -->
					<div
						v-else-if="getItemByIndex(virtualRow.index)!.type === 'log-group'"
						class="group flex gap-4"
					>
						<Avatar class="size-8 shrink-0 border bg-primary/10">
							<div
								class="flex items-center justify-center size-full text-primary font-semibold text-xs"
							>
								AI
							</div>
						</Avatar>

						<div class="flex flex-col gap-1 min-w-0 max-w-[85%]">
							<div class="flex items-center gap-2 px-1">
								<span class="text-xs font-medium text-muted-foreground">
									{{ getAgentLabel() }}
								</span>
								<span class="text-[10px] text-muted-foreground">
									{{ formatTime((getItemByIndex(virtualRow.index) as { type: 'log-group'; group: LogGroup }).group.timestamp) }}
								</span>
							</div>

							<div
								class="bg-card border rounded-2xl px-4 py-3 shadow-sm overflow-hidden"
							>
								<div
									@click="handleToggle((getItemByIndex(virtualRow.index) as { type: 'log-group'; group: LogGroup }).group.id)"
									class="flex items-center gap-2 text-xs font-medium text-muted-foreground select-none cursor-pointer hover:text-foreground min-w-0"
								>
									<component
										:is="
											conversation.expandedMessageIds.has((getItemByIndex(virtualRow.index) as { type: 'log-group'; group: LogGroup }).group.id)
												? ChevronDown
												: ChevronRight
										"
										class="size-3.5 opacity-50 shrink-0"
									/>
									<Sparkles
										v-if="getGroupTitleDetails((getItemByIndex(virtualRow.index) as { type: 'log-group'; group: LogGroup }).group).sourceType === 'thinking'"
										class="size-3.5 text-purple-500 shrink-0"
									/>
									<Terminal v-else class="size-3.5 text-blue-500 shrink-0"/>
									<span class="truncate"
										>{{ getGroupSummary((getItemByIndex(virtualRow.index) as { type: 'log-group'; group: LogGroup }).group) }}</span
									>
								</div>

								<div
									v-show="conversation.expandedMessageIds.has((getItemByIndex(virtualRow.index) as { type: 'log-group'; group: LogGroup }).group.id)"
									class="mt-3"
								>
									<div
										v-for="log in (getItemByIndex(virtualRow.index) as { type: 'log-group'; group: LogGroup }).group.logs"
										:key="log.id"
										class="relative pt-3 pb-2 border-t border-border/60 first:border-t-0 first:pt-0"
									>
										<div
											v-if="
												log.logType !== 'thinking' &&
												!shouldHideGroupLogTitle(log, (getItemByIndex(virtualRow.index) as { type: 'log-group'; group: LogGroup }).group)
											"
											@click="
												!isGroupLogAlwaysOpen(log) &&
												hasContent(log) &&
												handleToggle(log.id)
											"
											class="flex items-center gap-2 text-xs font-medium text-muted-foreground select-none"
											:class="
												!isGroupLogAlwaysOpen(log) && hasContent(log)
													? 'cursor-pointer hover:text-foreground'
													: 'cursor-default'
											"
										>
											<div
												v-if="isGroupLogAlwaysOpen(log) || !hasContent(log)"
												class="size-3.5"
											/>
											<component
												v-else
												:is="
													conversation.expandedMessageIds.has(log.id) ||
													(conversation.expandedMessageIds.has((getItemByIndex(virtualRow.index) as { type: 'log-group'; group: LogGroup }).group.id) &&
														shouldHideGroupLogTitle(log, (getItemByIndex(virtualRow.index) as { type: 'log-group'; group: LogGroup }).group))
														? ChevronDown
														: ChevronRight
												"
												class="size-3.5 opacity-50 shrink-0"
											/>

											<AlertCircle
												v-if="log.logType === 'error'"
												class="size-3.5 text-red-500 shrink-0"
											/>
											<Sparkles
												v-else-if="isThinkingLog(log.logType)"
												class="size-3.5 text-purple-500 shrink-0"
											/>
											<Cpu
												v-else-if="log.logType === 'system'"
												class="size-3.5 text-green-500 shrink-0"
											/>
											<Terminal v-else class="size-3.5 text-blue-500 shrink-0"/>
											<span
												v-if="!shouldHideGroupLogTitle(log, (getItemByIndex(virtualRow.index) as { type: 'log-group'; group: LogGroup }).group)"
											>
												{{ getCodexLogLabel(log) }}
											</span>
										</div>

										<div
											v-show="
												isThinkingLog(log.logType)
													? hasContent(log)
													: isGroupLogAlwaysOpen(log) ||
														conversation.expandedMessageIds.has(log.id) ||
														(conversation.expandedMessageIds.has((getItemByIndex(virtualRow.index) as { type: 'log-group'; group: LogGroup }).group.id) &&
															shouldHideGroupLogTitle(log, (getItemByIndex(virtualRow.index) as { type: 'log-group'; group: LogGroup }).group))
											"
											:class="[
												'relative',
												isThinkingLog(log.logType) ||
												shouldHideGroupLogTitle(log, (getItemByIndex(virtualRow.index) as { type: 'log-group'; group: LogGroup }).group)
													? ''
													: 'mt-2',
											]"
										>
											<div
												class="text-sm markdown-content"
												v-html="
													renderMarkdown(
														sanitizeLogContent(log.content, log.logType),
													)
												"
											/>

											<button
												@click.stop="
													handleCopy(
														sanitizeLogContent(log.content, log.logType),
														log.id,
													)
												"
												class="absolute top-2 right-2 size-6 rounded bg-background/60 border opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center hover:bg-background"
											>
												<Check
													v-if="conversation.copiedId === log.id"
													class="size-3 text-green-500"
												/>
												<Copy v-else class="size-3 text-muted-foreground"/>
											</button>
										</div>
									</div>
								</div>
							</div>
						</div>
					</div>
				</template>
			</div>
		</div>

		<!-- Scroll to bottom button -->
		<Transition name="fade">
			<button
				v-if="!isAutoScrollEnabled"
				@click="forceScrollToBottom"
				class="fixed bottom-24 right-8 z-10 flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-primary-foreground shadow-lg transition-all hover:bg-primary/90 hover:shadow-xl"
			>
				<ArrowDown class="size-4"/>
			</button>
		</Transition>
	</div>
</template>

<style scoped>
.fade-enter-active,
.fade-leave-active {
	transition:
		opacity 0.2s ease,
		transform 0.2s ease;
}

.fade-enter-from,
.fade-leave-to {
	opacity: 0;
	transform: translateY(10px);
}
</style>
