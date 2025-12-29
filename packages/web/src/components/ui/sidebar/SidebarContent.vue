<script setup lang="ts">
import type { HTMLAttributes } from "vue";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

const props = defineProps<{
	class?: HTMLAttributes["class"];
}>();
</script>

<template>
  <ScrollArea
    data-slot="sidebar-content"
    data-sidebar="content"
    scrollbar-variant="thin"
    :class="cn('flex min-h-0 flex-1 flex-col group-data-[collapsible=icon]:overflow-hidden', props.class)"
  >
    <div class="flex flex-col gap-2">
      <slot />
    </div>
  </ScrollArea>
</template>
