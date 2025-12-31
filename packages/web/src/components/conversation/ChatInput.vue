<script setup lang="ts">
import type { AgentMode, ReasoningLevel } from "@agent-manager/shared";
import { computed } from "vue";
import { ChevronDown, Loader2, Send, Square } from "lucide-vue-next";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { ModelTemplate } from "@/composables/useConversation";
import { groupModelTemplates } from "@/lib/modelTemplateGroups";

const props = defineProps<{
	input: string;
	isLoading: boolean;
	isGenerating: boolean;
	isUpdatingAgent: boolean;
	modelTemplates: ModelTemplate[];
	modelIdDraft: string;
	modeDraft: AgentMode;
	reasoningDraft: ReasoningLevel;
	isSwappingModel: boolean;
	isUpdatingMode: boolean;
	isUpdatingReasoning: boolean;
	supportsReasoning: boolean;
}>();

const emit = defineEmits<{
	(e: "update:input", value: string): void;
	(e: "update:modelIdDraft", value: string): void;
	(e: "update:modeDraft", value: AgentMode): void;
	(e: "update:reasoningDraft", value: ReasoningLevel): void;
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
	groupModelTemplates(props.modelTemplates),
);

const handleKeydown = (e: KeyboardEvent) => {
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
			<form @submit.prevent="emit('send')">
				<div class="flex items-center gap-2">
					<div
						class="flex-1 bg-card rounded-2xl border shadow-sm focus-within:ring-2 focus-within:ring-ring focus-within:border-transparent transition-all"
					>
						<Textarea
							:model-value="input"
							@update:model-value="emit('update:input', $event)"
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
						@click="emit('stop')"
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
								:value="modelIdDraft"
								@change="
									emit(
										'update:modelIdDraft',
										($event.target as HTMLSelectElement).value,
									)
								"
								class="h-6 w-auto min-w-[140px] rounded-md border border-input bg-transparent px-2 text-[10px] shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 appearance-none pr-6 cursor-pointer hover:bg-accent/50"
								:disabled="isUpdatingAgent || isLoading || modelTemplates.length === 0"
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
								<Loader2 v-if="isSwappingModel" class="size-2.5 animate-spin" />
								<ChevronDown class="size-3" />
							</div>
						</div>

						<!-- Mode Selector (Planning) -->
						<div class="relative min-w-[80px]">
							<select
								:value="modeDraft"
								@change="
									emit(
										'update:modeDraft',
										($event.target as HTMLSelectElement).value as AgentMode,
									)
								"
								class="h-6 w-auto min-w-[80px] rounded-md border border-input bg-transparent px-2 text-[10px] shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 appearance-none pr-6 cursor-pointer hover:bg-accent/50"
								:disabled="isUpdatingAgent || isLoading"
							>
								<option v-for="option in modeOptions" :key="option.value" :value="option.value">
									{{ option.label }}
								</option>
							</select>
							<div
								class="pointer-events-none absolute inset-y-0 right-0 gap-1 px-2 flex items-center text-muted-foreground"
							>
								<Loader2 v-if="isUpdatingMode" class="size-2.5 animate-spin" />
								<ChevronDown class="size-3" />
							</div>
						</div>

						<!-- Reasoning Selector -->
						<div v-if="supportsReasoning" class="relative min-w-[110px]">
							<select
								:value="reasoningDraft"
								@change="
									emit(
										'update:reasoningDraft',
										($event.target as HTMLSelectElement).value as ReasoningLevel,
									)
								"
								class="h-6 w-auto min-w-[110px] rounded-md border border-input bg-transparent px-2 text-[10px] shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 appearance-none pr-6 cursor-pointer hover:bg-accent/50"
								:disabled="isUpdatingAgent || isLoading"
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
								<Loader2 v-if="isUpdatingReasoning" class="size-2.5 animate-spin" />
								<ChevronDown class="size-3" />
							</div>
						</div>
					</div>
				</div>
			</form>
		</div>
	</div>
</template>
