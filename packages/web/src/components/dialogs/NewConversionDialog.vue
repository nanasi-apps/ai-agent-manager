<script setup lang="ts">
import type { AgentMode, ReasoningLevel } from "@agent-manager/shared";
import { computed, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import type { ModelTemplate } from "@/composables/useConversation";

import { useNewConversionDialog } from "@/composables/useNewConversionDialog";
import { groupModelTemplates } from "@/lib/modelTemplateGroups";
import { getRouteParamFrom } from "@/lib/route-params";
import { orpc } from "@/services/orpc";

interface Project {
	id: string;
	name: string;
}

const {
	isOpen,
	close,
	projectId: preselectedProjectId,
} = useNewConversionDialog();

const router = useRouter();
const route = useRoute();

const input = ref("");
const selectedProjectId = ref("");
const selectedModelId = ref("");
const selectedReasoning = ref<ReasoningLevel>("middle");
const selectedMode = ref<AgentMode>("regular");
const projects = ref<Project[]>([]);
const modelTemplates = ref<ModelTemplate[]>([]);
const isLoading = ref(false);
const isInitializing = ref(true);


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
	groupModelTemplates(modelTemplates.value),
);

const selectedModelTemplate = computed(() =>
	modelTemplates.value.find((m) => m.id === selectedModelId.value),
);

const supportsReasoning = computed(() => {
	const template = selectedModelTemplate.value;
	if (!template || template.agentType !== "codex") return false;
	if (!template.model) return true;
	return template.model.toLowerCase().startsWith("gpt");
});

const loadData = async () => {
	isInitializing.value = true;
	try {
		const [projRes, modelRes] = await Promise.all([
			orpc.listProjects({}),
			orpc.listModelTemplates({}),
		]);
		projects.value = projRes;
		modelTemplates.value = modelRes;

		if (!selectedModelId.value && modelTemplates.value.length > 0) {
			const preferred = modelTemplates.value.find(
				(model) => model.agentType !== "default",
			);
			selectedModelId.value = preferred?.id || modelTemplates.value[0]!.id;
		}

		// Auto-select project logic
		const routeProjectId = getRouteParamFrom(route.params, "id");

		// Priority: 1. Composable state (Explicit open) 2. Route param 3. Default (first)
		if (
			preselectedProjectId.value &&
			projects.value.some((p) => p.id === preselectedProjectId.value)
		) {
			selectedProjectId.value = preselectedProjectId.value;
		} else if (
			routeProjectId &&
			projects.value.some((p) => p.id === routeProjectId)
		) {
			selectedProjectId.value = routeProjectId;
		} else if (projects.value.length > 0 && !selectedProjectId.value) {
			selectedProjectId.value = projects.value[0]!.id;
		}
	} catch (e) {
		console.error("Failed to load initial data", e);
	} finally {
		isInitializing.value = false;
	}
};

// Reload data when dialog opens
watch(isOpen, (val) => {
	if (val) loadData();
});

watch(selectedModelId, () => {
	if (!supportsReasoning.value) return;
	if (!selectedReasoning.value) {
		selectedReasoning.value = "middle";
	}
});

const handleStart = async () => {
	if (!input.value.trim() || !selectedProjectId.value || !selectedModelId.value)
		return;

	isLoading.value = true;
	try {
		// Create new session via orpc
		const res = await orpc.createConversation({
			projectId: selectedProjectId.value,
			initialMessage: input.value,
			modelId: selectedModelId.value,
			reasoning: supportsReasoning.value ? selectedReasoning.value : undefined,
			mode: selectedMode.value,
		});

		window.dispatchEvent(new Event("agent-manager:data-change"));

		close();
		input.value = "";

		// Navigate to the new conversion

		router.push(`/conversions/${res.sessionId}`);
	} catch (e) {
		console.error("Failed to start conversation", e);
	} finally {
		isLoading.value = false;
	}
};

// Handle CMD+Enter to submit
const handleKeydown = (e: KeyboardEvent) => {
	if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
		e.preventDefault();
		handleStart();
	}
};
</script>

<template>
    <Dialog :open="isOpen" @update:open="(val) => !val && close()">
        <DialogContent class="overflow-x-hidden">
            <DialogHeader>
                <DialogTitle>Start New Conversation</DialogTitle>
                <DialogDescription>
                    Select a project and model to start your task.
                </DialogDescription>
            </DialogHeader>
            
            <div class="flex flex-col gap-4 py-2 max-h-[60vh] overflow-y-auto overflow-x-hidden pr-2 w-full">
                <!-- Selectors Row -->
                <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 w-full">
                    <div class="space-y-2 min-w-0">
                        <label class="text-xs font-medium text-muted-foreground">Project</label>
                        <div class="relative">
                            <select 
                                v-model="selectedProjectId"
                                class="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 appearance-none"
                            >
                                <option v-for="p in projects" :key="p.id" :value="p.id">
                                    {{ p.name }}
                                </option>
                            </select>
                            <!-- Chevron Icon -->
                            <div class="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-muted-foreground">
                                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-4 w-4"><path d="m6 9 6 6 6-6"/></svg>
                            </div>
                        </div>
                    </div>

                    <div class="space-y-2 min-w-0">
                        <label class="text-xs font-medium text-muted-foreground">Model</label>
                        <div class="relative">
                             <select 
                                v-model="selectedModelId"
                                class="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 appearance-none"
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
                             <div class="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-muted-foreground">
                                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-4 w-4"><path d="m6 9 6 6 6-6"/></svg>
                            </div>
                        </div>
                    </div>
                </div>

                <div v-if="supportsReasoning" class="space-y-2 min-w-0">
                    <label class="text-xs font-medium text-muted-foreground">Reasoning</label>
                    <div class="relative">
                        <select
                            v-model="selectedReasoning"
                            class="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 appearance-none"
                        >
                            <option v-for="option in reasoningOptions" :key="option.value" :value="option.value">
                                {{ option.label }}
                            </option>
                        </select>
                        <div class="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-muted-foreground">
                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-4 w-4"><path d="m6 9 6 6 6-6"/></svg>
                        </div>
                    </div>
                </div>

                <div class="space-y-2 min-w-0">
                    <label class="text-xs font-medium text-muted-foreground">Mode</label>
                    <div class="relative">
                        <select
                            v-model="selectedMode"
                            class="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 appearance-none"
                        >
                            <option v-for="option in modeOptions" :key="option.value" :value="option.value">
                                {{ option.label }}
                            </option>
                        </select>
                        <div class="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-muted-foreground">
                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-4 w-4"><path d="m6 9 6 6 6-6"/></svg>
                        </div>
                    </div>
                </div>

                <div class="space-y-2 min-w-0">
                    <label class="text-xs font-medium text-muted-foreground">Initial Request</label>
                    <Textarea
                        v-model="input"
                        placeholder="Describe your task... (Cmd+Enter to send)"
                        @keydown="handleKeydown"
                        :disabled="isLoading"
                        class="min-h-[100px] max-h-[300px] overflow-y-auto w-full resize-none break-all"
                        autofocus
                    />
                </div>
            </div>

            <DialogFooter class="sm:justify-end">
                <Button type="button" variant="secondary" @click="close">
                    Close
                </Button>
                <Button 
                    type="submit" 
                    @click="handleStart" 
                    :disabled="isLoading || !input.trim() || !selectedProjectId" 
                    class="bg-blue-600 hover:bg-blue-500 text-white"
                >
                    <span v-if="isLoading">Starting...</span>
                    <span v-else>Start conversation</span>
                </Button>
            </DialogFooter>
        </DialogContent>
    </Dialog>
</template>
