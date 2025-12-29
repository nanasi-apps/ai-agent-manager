<script setup lang="ts">
import type { ScrollAreaScrollbarProps } from "reka-ui"
import type { HTMLAttributes } from "vue"
import { reactiveOmit } from "@vueuse/core"
import { ScrollAreaScrollbar, ScrollAreaThumb } from "reka-ui"
import { cn } from "@/lib/utils"

const props = withDefaults(defineProps<ScrollAreaScrollbarProps & {
  class?: HTMLAttributes["class"]
  variant?: 'default' | 'thin'
}>(), {
  orientation: "vertical",
  variant: "default",
})

const delegatedProps = reactiveOmit(props, "class", "variant")
</script>

<template>
  <ScrollAreaScrollbar
    data-slot="scroll-area-scrollbar"
    v-bind="delegatedProps"
    :class="
      cn('flex touch-none p-px transition-colors select-none',
         orientation === 'vertical'
           && (variant === 'thin' ? 'h-full w-1' : 'h-full w-2'),
         orientation === 'horizontal'
           && (variant === 'thin' ? 'h-1 flex-col' : 'h-2 flex-col'),
         props.class)"
  >
    <ScrollAreaThumb
      data-slot="scroll-area-thumb"
      class="bg-muted-foreground/30 hover:bg-muted-foreground/50 relative flex-1 rounded-full transition-colors"
    />
  </ScrollAreaScrollbar>
</template>
