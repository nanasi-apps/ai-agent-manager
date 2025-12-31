<script setup lang="ts">
import { FileText } from "lucide-vue-next";
import { useI18n } from "vue-i18n";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useMarkdown } from "@/composables/useMarkdown";

const props = defineProps<{
	content: string;
	isOpen: boolean;
}>();

defineEmits<{
	(e: "close"): void;
}>();

const { t } = useI18n();
const { renderMarkdown } = useMarkdown();
</script>

<template>
  <div class="flex flex-col h-full bg-background border-l">
    <!-- Header -->
    <div class="flex items-center justify-between p-4 border-b h-14 shrink-0">
      <div class="flex items-center gap-2">
        <FileText class="size-5" />
        <h2 class="font-semibold">{{ t('plan.title', 'Implementation Plan') }}</h2>
      </div>
      <button
        class="text-muted-foreground hover:text-foreground p-1 rounded-md hover:bg-muted"
        @click="$emit('close')"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          class="lucide lucide-x"
        >
          <path d="M18 6 6 18" />
          <path d="m6 6 12 12" />
        </svg>
      </button>
    </div>

    <!-- Content -->
    <ScrollArea class="flex-1">
      <div class="p-6">
        <div v-if="!content" class="text-center text-muted-foreground py-10">
          <FileText class="size-12 mx-auto mb-4 opacity-20" />
          <p>{{ t('plan.empty', 'No plan generated yet.') }}</p>
        </div>
        <div
          v-else
          class="markdown-content prose dark:prose-invert max-w-none"
          v-html="renderMarkdown(content)"
        />
      </div>
    </ScrollArea>
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
