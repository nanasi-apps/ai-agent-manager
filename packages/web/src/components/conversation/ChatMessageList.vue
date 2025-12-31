<script setup lang="ts">
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
import { Avatar } from "@/components/ui/avatar";
import type { LogType, Message } from "@/composables/useConversation";
import { useMarkdown } from "@/composables/useMarkdown";

const props = defineProps<{
	messages: Message[];
	isGenerating: boolean;
	copiedId: string | null;
	expandedMessageIds: Set<string>;
}>();

const emit = defineEmits<{
	(e: "copy", content: string, id: string): void;
	(e: "toggle", id: string): void;
}>();

const { renderMarkdown } = useMarkdown();

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

const formatTime = (timestamp: number) => {
	return new Date(timestamp).toLocaleTimeString([], {
		hour: "2-digit",
		minute: "2-digit",
	});
};
</script>

<template>
	<div class="flex flex-col gap-2 p-4 max-w-3xl mx-auto">
		<div
			v-if="messages.length === 0"
			class="flex flex-col items-center justify-center py-20 text-center"
		>
			<div
				class="size-12 rounded-full bg-muted flex items-center justify-center mb-4"
			>
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
				v-if="
					msg.role === 'user' ||
					(msg.role === 'agent' && (!msg.logType || msg.logType === 'text'))
				"
				class="group flex gap-4 my-4"
				:class="{ 'flex-row-reverse': msg.role === 'user' }"
			>
				<!-- Avatar -->
				<Avatar
					class="size-8 shrink-0 border"
					:class="msg.role === 'agent' ? 'bg-primary/10' : 'bg-muted'"
				>
					<div
						v-if="msg.role === 'agent'"
						class="flex items-center justify-center size-full text-primary font-semibold text-xs"
					>
						AI
					</div>
					<div
						v-else
						class="flex items-center justify-center size-full text-muted-foreground font-semibold text-xs"
					>
						You
					</div>
				</Avatar>

				<!-- Message Content -->
				<div
					class="flex flex-col gap-1 min-w-0 max-w-[85%]"
					:class="{ 'items-end': msg.role === 'user' }"
				>
					<div class="flex items-center gap-2 px-1">
						<span class="text-xs font-medium text-muted-foreground">
							{{ msg.role === "agent" ? "Agent" : "You" }}
						</span>
						<span
							class="text-[10px] text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity"
						>
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
							@click.stop="emit('copy', msg.content, msg.id)"
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
					@click="!isAlwaysOpen(msg) && hasContent(msg) && emit('toggle', msg.id)"
					class="flex items-center gap-2 select-none px-2 py-1.5 rounded-md transition-colors opacity-80 hover:opacity-100"
					:class="
						!isAlwaysOpen(msg) && hasContent(msg)
							? 'cursor-pointer hover:bg-black/5 dark:hover:bg-white/5'
							: 'cursor-default'
					"
				>
					<!-- Spacer if always open or empty, Chevron otherwise -->
					<div v-if="isAlwaysOpen(msg) || !hasContent(msg)" class="size-3.5" />
					<component
						v-else
						:is="expandedMessageIds.has(msg.id) ? ChevronDown : ChevronRight"
						class="size-3.5 opacity-50 shrink-0"
					/>

					<!-- Icon based on type -->
					<Terminal
						v-if="msg.logType === 'tool_call' || msg.logType === 'tool_result'"
						class="size-3.5 text-blue-500 shrink-0"
					/>
					<AlertCircle
						v-else-if="msg.logType === 'error'"
						class="size-3.5 text-red-500 shrink-0"
					/>
					<Sparkles
						v-else-if="msg.logType === 'thinking'"
						class="size-3.5 text-purple-500 shrink-0"
					/>
					<Cpu
						v-else-if="msg.logType === 'system'"
						class="size-3.5 text-green-500 shrink-0"
					/>
					<AlertCircle v-else class="size-3.5 text-yellow-500 shrink-0" />

					<span
						class="text-xs font-medium font-mono text-muted-foreground truncate max-w-[200px]"
					>
						{{ getLogSummary(msg) }}
					</span>

					<!-- Timestamp (faint) -->
					<span class="ml-auto text-[10px] text-muted-foreground/40">{{
						formatTime(msg.timestamp)
					}}</span>
				</div>

				<!-- Content (Visible if always open OR manually expanded) -->
				<div
					v-show="isAlwaysOpen(msg) || expandedMessageIds.has(msg.id)"
					class="pl-8 pr-2 pb-2"
				>
					<div
						class="relative bg-muted/30 border rounded-md px-3 py-2 text-sm markdown-content"
					>
						<div
							v-html="renderMarkdown(sanitizeLogContent(msg.content, msg.logType))"
						/>

						<!-- Copy Button (Small) -->
						<button
							@click.stop="
								emit('copy', sanitizeLogContent(msg.content, msg.logType), msg.id)
							"
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
