<script setup lang="ts">
import type { ModelTemplate } from "@agent-manager/shared";
import { CheckCircle2, FileText, Loader2 } from "lucide-vue-next";
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { renderMarkdown } from "@/lib/markdown";
import { useConversationStore } from "@/stores/conversation";

const { t } = useI18n();
const conversation = useConversationStore();

// Approve dialog state
const isApproveDialogOpen = ref(false);
const selectedModelId = ref("");

const hasContent = computed(() => !!conversation.latestPlanContent?.trim());

// Filter to only agent mode compatible models
const availableModels = computed(() => {
	return conversation.modelTemplates.filter(
		(m) => m.agentType !== "default",
	);
});

const formatModelLabel = (model: ModelTemplate) => {
	if (!model.agentName || model.name.includes(model.agentName)) {
		return model.name;
	}
	return `${model.name} (${model.agentName})`;
};

const openApproveDialog = () => {
	// Default to first available model
	if (availableModels.value.length > 0 && !selectedModelId.value) {
		selectedModelId.value = availableModels.value[0]!.id;
	}
	isApproveDialogOpen.value = true;
};

const handleApprove = async () => {
	if (!selectedModelId.value) return;
	await conversation.approvePlan(selectedModelId.value);
	isApproveDialogOpen.value = false;
};

const closeApproveDialog = () => {
	isApproveDialogOpen.value = false;
};


</script>

<template>
  <div class="flex flex-col h-full bg-background border-l">
    <!-- Header -->
    <div class="flex items-center justify-between p-4 border-b h-14 shrink-0">
      <div class="flex items-center gap-2">
        <FileText class="size-5" />
        <h2 class="font-semibold">{{ t('plan.title', 'Implementation Plan') }}</h2>
      </div>
      <div class="flex items-center gap-2">
        <!-- Approve Button -->
        <Button
          v-if="hasContent"
          size="sm"
          variant="default"
          class="gap-1.5"
          :disabled="conversation.isApproving"
          @click="openApproveDialog"
        >
          <Loader2 v-if="conversation.isApproving" class="size-4 animate-spin" />
          <CheckCircle2 v-else class="size-4" />
          {{ t('plan.approve', 'Approve') }}
        </Button>
        <!-- Close Button -->

      </div>
    </div>

    <!-- Content with ScrollArea -->
    <ScrollArea class="flex-1 min-h-0">
      <div class="p-6">
        <div v-if="!conversation.latestPlanContent" class="text-center text-muted-foreground py-10">
          <FileText class="size-12 mx-auto mb-4 opacity-20" />
          <p>{{ t('plan.empty', 'No plan generated yet.') }}</p>
        </div>
        <div
          v-else
          class="markdown-content prose dark:prose-invert max-w-none"
          v-html="renderMarkdown(conversation.latestPlanContent)"
        />
      </div>
    </ScrollArea>

    <!-- Model Selection Dialog -->
    <Dialog v-model:open="isApproveDialogOpen">
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{{ t('plan.approveDialog.title', 'Approve & Execute Plan') }}</DialogTitle>
          <DialogDescription>
            {{ t('plan.approveDialog.description', 'Select a model to execute this plan in Agent mode.') }}
          </DialogDescription>
        </DialogHeader>

        <div class="py-4">
          <label class="text-sm font-medium mb-2 block">
            {{ t('plan.approveDialog.modelLabel', 'Execution Model') }}
          </label>
          <select
            v-model="selectedModelId"
            class="w-full h-10 px-3 py-2 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
          >
            <option
              v-for="model in availableModels"
              :key="model.id"
              :value="model.id"
            >
              {{ formatModelLabel(model) }}
            </option>
          </select>
        </div>

        <DialogFooter>
          <Button variant="outline" @click="closeApproveDialog">
            {{ t('common.cancel', 'Cancel') }}
          </Button>
          <Button
            :disabled="!selectedModelId || conversation.isApproving"
            @click="handleApprove"
          >
            <Loader2 v-if="conversation.isApproving" class="size-4 mr-2 animate-spin" />
            {{ t('plan.approveDialog.confirm', 'Execute Plan') }}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>
</template>

<style scoped>
/* Reuse markdown styles from chat or define specific ones here */
.markdown-content :deep(h1) {
  font-size: 1.5rem;
  font-weight: 700;
  margin-top: 1.5rem;
  margin-bottom: 1rem;
}
.markdown-content :deep(h2) {
  font-size: 1.25rem;
  font-weight: 600;
  margin-top: 1.5rem;
  margin-bottom: 0.75rem;
}
.markdown-content :deep(ul) {
  list-style-type: disc;
  padding-left: 1.5rem;
  margin-bottom: 1rem;
}
.markdown-content :deep(ol) {
  list-style-type: decimal;
  padding-left: 1.5rem;
  margin-bottom: 1rem;
}
.markdown-content :deep(p) {
  margin-bottom: 1rem;
  line-height: 1.6;
}
.markdown-content :deep(pre) {
  background-color: hsl(var(--muted));
  padding: 1rem;
  border-radius: 0.5rem;
  overflow-x: auto;
  margin-bottom: 1rem;
}
.markdown-content :deep(code) {
  font-family: monospace;
  background-color: hsl(var(--muted));
  padding: 0.2em 0.4em;
  border-radius: 0.25rem;
  font-size: 0.9em;
}
.markdown-content :deep(pre code) {
  background-color: transparent;
  padding: 0;
}
</style>
