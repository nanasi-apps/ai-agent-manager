<script setup lang="ts">
import { ref, watch, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Button } from '@/components/ui/button'
import { Plus, MessageSquare, Clock, ExternalLink } from 'lucide-vue-next'
import { Card, CardContent } from '@/components/ui/card'
import { useNewConversionDialog } from '@/composables/useNewConversionDialog'
import { orpc } from '@/services/orpc'

const route = useRoute()
const router = useRouter()
const { open } = useNewConversionDialog()

// Safely access route param
const projectId = computed(() => (route.params as any).id as string)
const project = ref<{ id: string, name: string } | null>(null)
const conversations = ref<any[]>([])

const loadData = async () => {
  const id = projectId.value
  if (!id) return
  try {
     const [p, convs] = await Promise.all([
       orpc.getProject({ projectId: id }),
       orpc.listConversations({ projectId: id })
     ])
     project.value = p
     conversations.value = convs.sort((a, b) => b.updatedAt - a.updatedAt)
  } catch (e) {
     console.error(e)
  }
}

const openConversation = (id: string) => {
  router.push(`/conversions/${id}`)
}

const formatTime = (timestamp: number) => {
  const date = new Date(timestamp)
  const now = new Date()
  const diff = now.getTime() - date.getTime()
  
  if (diff < 60000) return 'Just now'
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`
  return date.toLocaleDateString()
}

watch(projectId, loadData, { immediate: true })
</script>

<template>
  <div class="p-6">
    <div class="flex items-center justify-between mb-8">
       <div>
         <h1 class="text-2xl font-bold">Project Viewer</h1>
         <p class="text-muted-foreground">
           Viewing project: <span class="font-medium text-foreground">{{ project?.name || projectId }}</span>
         </p>
       </div>
       <Button @click="open">
         <Plus class="w-4 h-4 mr-2" />
         New Conversion
       </Button>
    </div>

    <!-- Conversations List -->
    <div class="space-y-4">
      <h2 class="text-xl font-semibold">Conversations</h2>
      
      <div v-if="conversations.length > 0" class="space-y-2">
        <Card 
          v-for="conv in conversations" 
          :key="conv.id"
          class="cursor-pointer transition-all hover:shadow-md hover:border-primary/50"
          @click="openConversation(conv.id)"
        >
          <CardContent class="p-4 flex items-center justify-between">
            <div class="flex items-center gap-3 min-w-0">
              <MessageSquare class="size-5 text-muted-foreground shrink-0" />
              <div class="min-w-0">
                <p class="font-medium truncate">{{ conv.title }}</p>
                <p class="text-xs text-muted-foreground">{{ project?.name }}</p>
              </div>
            </div>
            <div class="flex items-center gap-2 shrink-0">
              <div class="flex items-center gap-1 text-xs text-muted-foreground">
                <Clock class="size-3" />
                {{ formatTime(conv.updatedAt) }}
              </div>
              <ExternalLink class="size-4 text-muted-foreground" />
            </div>
          </CardContent>
        </Card>
      </div>

      <div v-else class="text-center py-12 text-muted-foreground border rounded-lg border-dashed">
        <MessageSquare class="size-12 mx-auto mb-4 opacity-20" />
        <p>No conversations in this project yet.</p>
        <Button variant="link" @click="open" class="mt-2">
          Start your first conversation
        </Button>
      </div>
    </div>
  </div>
</template>
