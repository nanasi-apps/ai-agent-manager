<script setup lang="ts">
import { computed } from "vue";
import {
	AlertCircle,
	Check,
	ChevronDown,
	ChevronRight,
	Copy,
	Cpu,
	Sparkles,
	Terminal,
} from "lucide-vue-next";
import { useI18n } from "vue-i18n";
import { Avatar } from "@/components/ui/avatar";
import { useConversationStore, type LogType, type Message } from "@/stores/conversation";
import { renderMarkdown } from "@/lib/markdown";

const { t } = useI18n();
const conversation = useConversationStore();

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
	if (!currentModel) return t('chat.agent');
	
	const modelName = currentModel.model || currentModel.name;
	const agentName = currentModel.agentName;
	
	if (modelName && agentName) {
		return `${modelName} - ${agentName}`;
	}
	return agentName || t('chat.agent');
};

const getLogSummary = (msg: Message) => {
	const content = msg.content || "";
	const type = msg.logType;

	if (type === "system") {
		const modelMatch = content.match(new RegExp("\\[Using model: ([^\\]]+)\\]"));
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
		new RegExp("^\\s*\\[Tool: [^\\]]+\\]\\s*"),
		new RegExp("^\\s*\\[Executing: [^\\]]+\\]\\s*"),
		new RegExp("^\\s*\\[Result(: [^\\]]+)?\\]\\s*"),
		new RegExp("^\\s*\\[Thinking\\]\\s*"),
		new RegExp("^\\s*\\[Error\\]\\s*"),
		new RegExp("^\\s*\\[System\\]\\s*"),
		new RegExp("^\\s*\\[Using model: [^\\]]+\\]\\s*"),
		new RegExp("^\\s*\\[Output\\]\\s*"),
		new RegExp("^\\s*\\[File [^:]+: [^\\]]+\\]\\s*"),
		new RegExp("^\\s*\\[Exit code: [^\\]]+\\]\\s*"),
		new RegExp("^\\s*\\[Session started\\]\\s*"),
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
		return "```json\n" + clean + "\n```";
	}

	if (logType === "tool_result") {
		if (clean.startsWith("```")) return clean;
		return "```\n" + clean + "\n```";
	}

	return clean;
};

const hasContent = (msg: Message) => {
	return getCleanContent(msg.content, msg.logType).length > 0;
};

const isAlwaysOpen = (msg: Message) => {
	return (msg.logType === "system" || msg.logType === "error") && hasContent(msg)
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
					id: `log-group-${logs[0]!.id}`,
					timestamp: logs[0]!.timestamp,
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

const handleCopy = async (content: string, id: string) => {
	await conversation.copyMessage(content, id);
};

const handleToggle = (id: string) => {
	conversation.toggleMessage(id);
};
</script>

<template>
	<div class="flex flex-col gap-2 p-4 max-w-3xl mx-auto">
		<div
			v-if="conversation.messages.length === 0"
			class="flex flex-col items-center justify-center py-20 text-center"
		>
			<div
				class="size-12 rounded-full bg-muted flex items-center justify-center mb-4"
			>
				<Sparkles class="size-6 text-muted-foreground" />
			</div>
			<h3 class="font-semibold text-lg mb-2">{{ t('chat.startConversation') }}</h3>
			<p class="text-sm text-muted-foreground max-w-sm">
				{{ t('chat.startPrompt') }}
			</p>
		</div>

		<div
			v-for="item in displayItems"
			:key="item.type === 'message' ? item.message.id : item.group.id"
		>
			<template v-if="item.type === 'message'">
				<!-- Type 1: Standard Chat Balloon (User or Agent 'text') -->
				<div
					v-if="
						item.message.role === 'user' ||
						(item.message.role === 'agent' &&
							(!item.message.logType || item.message.logType === 'text'))
					"
					class="group flex gap-4 my-4"
					:class="{ 'flex-row-reverse': item.message.role === 'user' }"
				>
					<!-- Avatar -->
					<Avatar
						class="size-8 shrink-0 border"
						:class="
							item.message.role === 'agent' ? 'bg-primary/10' : 'bg-muted'
						"
					>
						<div
							v-if="item.message.role === 'agent'"
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
						:class="{ 'items-end': item.message.role === 'user' }"
					>
						<div class="flex items-center gap-2 px-1">
							<span class="text-xs font-medium text-muted-foreground">
								{{
									item.message.role === "agent"
										? getAgentLabel()
										: t('chat.you')
								}}
							</span>
							<span
								class="text-[10px] text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity"
							>
								{{ formatTime(item.message.timestamp) }}
							</span>
						</div>
						<div
							class="relative bg-card border rounded-2xl px-4 py-3 shadow-sm markdown-content"
							:class="{
								'rounded-tr-md': item.message.role === 'user',
								'rounded-tl-md': item.message.role === 'agent',
							}"
						>
							<div v-html="renderMarkdown(item.message.content)" />

							<!-- Copy Button -->
							<button
								@click.stop="handleCopy(item.message.content, item.message.id)"
								class="absolute top-2 right-2 size-7 rounded-lg bg-background/80 border opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center hover:bg-muted"
							>
								<Check
									v-if="conversation.copiedId === item.message.id"
									class="size-3.5 text-green-500"
								/>
								<Copy v-else class="size-3.5 text-muted-foreground" />
							</button>
						</div>
					</div>
				</div>

				<!-- Type 2: System / Tool / Thinking Log (Minimal Timeline Style) -->
				<div v-else class="flex flex-col gap-0.5 py-0.5 px-4 group">
					<!-- Header -->
					<div
						@click="
							!isAlwaysOpen(item.message) &&
							hasContent(item.message) &&
							handleToggle(item.message.id)
						"
						class="flex items-center gap-2 select-none px-2 py-1.5 rounded-md transition-colors opacity-80 hover:opacity-100"
						:class="
							!isAlwaysOpen(item.message) && hasContent(item.message)
									? 'cursor-pointer hover:bg-black/5 dark:hover:bg-white/5'
										: 'cursor-default'
						"
					>
						<!-- Spacer if always open or empty, Chevron otherwise -->
						<div
							v-if="isAlwaysOpen(item.message) || !hasContent(item.message)"
							class="size-3.5"
						/>
						<component
							v-else
							:is="
								conversation.expandedMessageIds.has(item.message.id)
									? ChevronDown
									: ChevronRight
							"
							class="size-3.5 opacity-50 shrink-0"
						/>

						<!-- Icon based on type -->
						<Terminal
							v-if="
								item.message.logType === 'tool_call' ||
								item.message.logType === 'tool_result'
							"
							class="size-3.5 text-blue-500 shrink-0"
						/>
						<AlertCircle
							v-else-if="item.message.logType === 'error'"
							class="size-3.5 text-red-500 shrink-0"
						/>
						<Sparkles
							v-else-if="item.message.logType === 'thinking'"
							class="size-3.5 text-purple-500 shrink-0"
						/>
						<Cpu
							v-else-if="item.message.logType === 'system'"
							class="size-3.5 text-green-500 shrink-0"
						/>
						<AlertCircle v-else class="size-3.5 text-yellow-500 shrink-0" />

						<span
							class="text-xs font-medium font-mono text-muted-foreground truncate max-w-[200px]"
						>
							{{ getLogSummary(item.message) }}
						</span>

						<!-- Timestamp (faint) -->
						<span class="ml-auto text-[10px] text-muted-foreground/40">{{
							formatTime(item.message.timestamp)
						}}</span>
					</div>

					<!-- Content (Visible if always open OR manually expanded) -->
					<div
						v-show="
							isAlwaysOpen(item.message) ||
							conversation.expandedMessageIds.has(item.message.id)
						"
						class="pl-8 pr-2 pb-2"
					>
						<div
							class="relative bg-muted/30 border rounded-md px-3 py-2 text-sm markdown-content"
						>
							<div
								v-html="
									renderMarkdown(
										sanitizeLogContent(item.message.content, item.message.logType),
									)
								"
							/>

							<!-- Copy Button (Small) -->
							<button
								@click.stop="
									handleCopy(
										sanitizeLogContent(
											item.message.content,
											item.message.logType,
										),
										item.message.id,
									)
								"
								class="absolute top-2 right-2 size-6 rounded bg-background/50 border opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center hover:bg-background"
							>
								<Check
									v-if="conversation.copiedId === item.message.id"
									class="size-3 text-green-500"
								/>
								<Copy v-else class="size-3 text-muted-foreground" />
							</button>
						</div>
					</div>
				</div>
			</template>

			<!-- Group Thinking + Tool Calls into one message -->
			<div v-else class="group flex gap-4 my-4">
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
							{{ formatTime(item.group.timestamp) }}
						</span>
					</div>

					<div class="bg-card border rounded-2xl px-4 py-3 shadow-sm">
						<div
							@click="handleToggle(item.group.id)"
							class="flex items-center gap-2 text-xs font-medium text-muted-foreground select-none cursor-pointer hover:text-foreground min-w-0"
						>
							<component
								:is="
									conversation.expandedMessageIds.has(item.group.id)
										? ChevronDown
										: ChevronRight
								"
								class="size-3.5 opacity-50 shrink-0"
							/>
							<Sparkles
								v-if="getGroupTitleDetails(item.group).sourceType === 'thinking'"
								class="size-3.5 text-purple-500 shrink-0"
							/>
							<Terminal
								v-else
								class="size-3.5 text-blue-500 shrink-0"
							/>
							<span class="truncate">{{ getGroupSummary(item.group) }}</span>
						</div>

						<div v-show="conversation.expandedMessageIds.has(item.group.id)" class="mt-3">
							<div
								v-for="log in item.group.logs"
								:key="log.id"
								class="relative pt-3 pb-2 border-t border-border/60 first:border-t-0 first:pt-0"
							>
								<div
									v-if="
										log.logType !== 'thinking' &&
										!shouldHideGroupLogTitle(log, item.group)
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
											(conversation.expandedMessageIds.has(item.group.id) &&
												shouldHideGroupLogTitle(log, item.group))
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
									<Terminal
										v-else
										class="size-3.5 text-blue-500 shrink-0"
									/>
									<span v-if="!shouldHideGroupLogTitle(log, item.group)">
										{{ getCodexLogLabel(log) }}
									</span>
								</div>

								<div
									v-show="
										isThinkingLog(log.logType)
											? hasContent(log)
											: isGroupLogAlwaysOpen(log) ||
												conversation.expandedMessageIds.has(log.id) ||
												(conversation.expandedMessageIds.has(item.group.id) &&
													shouldHideGroupLogTitle(log, item.group))
									"
									:class="[
										'relative',
										isThinkingLog(log.logType) ||
										shouldHideGroupLogTitle(log, item.group)
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
										<Copy v-else class="size-3 text-muted-foreground" />
									</button>
								</div>
							</div>
						</div>
					</div>
				</div>
			</div>
		</div>

		<!-- Typing Indicator (shown when waiting for response) -->
		<div v-if="conversation.isGenerating" class="flex gap-4">
			<Avatar class="size-8 shrink-0 border bg-primary/10">
				<div
					class="flex items-center justify-center size-full text-primary font-semibold text-xs"
				>
					AI
				</div>
			</Avatar>
			<div class="bg-card border rounded-2xl rounded-tl-md px-4 py-3 shadow-sm">
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

		<!-- Scroll target -->
		<div class="h-px" />
	</div>
</template>
