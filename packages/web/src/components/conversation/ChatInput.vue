<script setup lang="ts">
import type { AgentMode, ReasoningLevel } from "@agent-manager/shared";
import { ChevronDown, Loader2, Send, Square } from "lucide-vue-next";
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { groupModelTemplates } from "@/lib/modelTemplateGroups";
import { useConversationStore } from "@/stores/conversation";
import { useSettingsStore } from "@/stores/settings";

const { t } = useI18n();
const conversation = useConversationStore();
const settingsStore = useSettingsStore();

const emit = defineEmits<{
	(e: "send"): void;
	(e: "stop"): void;
}>();

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

const groupedModelTemplates = computed(() =>
	groupModelTemplates(conversation.modelTemplates, {
		providers: settingsStore.providers,
	}),
);

const isSelectorDisabled = computed(
	() =>
		conversation.sessionId === "new" ||
		conversation.isGenerating ||
		conversation.isLoading,
);

const handleKeydown = (e: KeyboardEvent) => {
	if (e.isComposing) return;
	if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
		e.preventDefault();
		emit("send");
	}
};
</script>

<template>
	<div
		class="border-t bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 shrink-0"
	>
		<div class="max-w-3xl mx-auto p-4 flex flex-col gap-2">
			<div>
				<div class="flex items-center gap-2">
						<Textarea
							v-model="conversation.input"
							:placeholder="t('chat.placeholder')"
							class="min-h-[24px] max-h-[200px] py-3 px-4 bg-transparent border focus-within:ring-2 focus-within:ring-ring focus-within:border-transparent transition-all focus-visible:ring-0 resize-none shadow-none text-sm"
							:disabled="conversation.isLoading"
							@keydown="handleKeydown"
							autofocus
						/>

					<!-- Stop Button (shown when generating) -->
					<Button
						v-if="conversation.isGenerating"
						type="button"
						size="icon"
						@click="emit('stop')"
						class="h-11 w-11 shrink-0 rounded-xl bg-red-600 hover:bg-red-700 shadow-lg shadow-red-600/20 transition-all text-white border-0"
					>
						<Square class="size-5 fill-current" />
					</Button>

					<!-- Send Button (shown when not generating) -->
					<Button
						v-else
						type="button"
						size="icon"
						class="h-11 w-11 shrink-0 rounded-xl bg-blue-600 hover:bg-blue-700 shadow-lg shadow-blue-600/20 transition-all text-white border-0"
						:class="{ 'opacity-50 cursor-not-allowed': !conversation.input.trim() || conversation.isLoading }"
						:disabled="!conversation.input.trim() || conversation.isLoading"
						@click="emit('send')"
					>
						<Loader2 v-if="conversation.isLoading" class="size-5 animate-spin" />
						<Send v-else class="size-5" />
					</Button>
				</div>

				<div v-if="!isSelectorDisabled" class="flex items-center justify-between mt-2 px-1">
					<!-- Selectors Group -->
					<div class="flex items-center gap-2">
						<!-- Model Selector -->
						<div class="relative min-w-[120px]">
							<select
								v-model="conversation.modelIdDraft"
								class="h-6 w-auto min-w-[140px] rounded-md border border-input bg-transparent px-2 text-[10px] shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 appearance-none pr-6 cursor-pointer hover:bg-accent/50"
								:disabled="conversation.isUpdatingAgent || conversation.isLoading || conversation.modelTemplates.length === 0"
							>
								<optgroup
									v-for="group in groupedModelTemplates"
									:key="group.agentType"
									:label="group.label"
								>
									<option v-for="m in group.models" :key="m.id" :value="m.id">
										{{ m.name }}
									</option>
								</optgroup>
							</select>
							<div
								class="pointer-events-none absolute inset-y-0 right-0 gap-1 px-2 flex items-center text-muted-foreground"
							>
								<Loader2 v-if="conversation.isSwappingModel" class="size-2.5 animate-spin" />
								<ChevronDown class="size-3" />
							</div>
						</div>

						<!-- Mode Selector (Planning) -->
						<div class="relative min-w-[80px]">
							<select
								v-model="conversation.modeDraft"
								class="h-6 w-auto min-w-[80px] rounded-md border border-input bg-transparent px-2 text-[10px] shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 appearance-none pr-6 cursor-pointer hover:bg-accent/50"
								:disabled="conversation.isUpdatingAgent || conversation.isLoading"
							>
								<option v-for="option in modeOptions" :key="option.value" :value="option.value">
									{{ option.label }}
								</option>
							</select>
							<div
								class="pointer-events-none absolute inset-y-0 right-0 gap-1 px-2 flex items-center text-muted-foreground"
							>
								<Loader2 v-if="conversation.isUpdatingMode" class="size-2.5 animate-spin" />
								<ChevronDown class="size-3" />
							</div>
						</div>

						<!-- Reasoning Selector -->
						<div v-if="conversation.supportsReasoning" class="relative min-w-[110px]">
							<select
								v-model="conversation.reasoningDraft"
								class="h-6 w-auto min-w-[110px] rounded-md border border-input bg-transparent px-2 text-[10px] shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 appearance-none pr-6 cursor-pointer hover:bg-accent/50"
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
							<div
								class="pointer-events-none absolute inset-y-0 right-0 gap-1 px-2 flex items-center text-muted-foreground"
							>
								<Loader2 v-if="conversation.isUpdatingReasoning" class="size-2.5 animate-spin" />
								<ChevronDown class="size-3" />
							</div>
						</div>
					</div>
				</div>
			</div>
		</div>
	</div>
</template>
