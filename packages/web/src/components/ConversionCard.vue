<script setup lang="ts">
import { computed } from 'vue'
import { MessageSquare, Clock, ExternalLink } from 'lucide-vue-next'
import { Card, CardContent } from '@/components/ui/card'

const props = defineProps<{
  title: string
  projectName?: string
  updatedAt: number
}>()

const formattedTime = computed(() => {
  const date = new Date(props.updatedAt)
  const now = new Date()
  const diff = now.getTime() - date.getTime()
  
  if (diff < 60000) return 'Just now'
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`
  return date.toLocaleDateString()
})
</script>

<template>
  <Card 
    class="cursor-pointer transition-all hover:shadow-md hover:border-primary/50"
  >
    <CardContent class="p-4 flex items-center justify-between">
      <div class="flex items-center gap-3 min-w-0">
        <MessageSquare class="size-5 text-muted-foreground shrink-0" />
        <div class="min-w-0">
          <p class="font-medium truncate">{{ title }}</p>
          <p v-if="projectName" class="text-xs text-muted-foreground">{{ projectName }}</p>
        </div>
      </div>
      <div class="flex items-center gap-2 shrink-0">
        <div class="flex items-center gap-1 text-xs text-muted-foreground">
          <Clock class="size-3" />
          {{ formattedTime }}
        </div>
        <ExternalLink class="size-4 text-muted-foreground" />
      </div>
    </CardContent>
  </Card>
</template>
