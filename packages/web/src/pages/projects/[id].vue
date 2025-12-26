<script setup lang="ts">
import { ref, watch, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Button } from '@/components/ui/button'
import { Plus, MessageSquare, Loader2 } from 'lucide-vue-next'
import ConversionCard from '@/components/ConversionCard.vue'
import { useNewConversionDialog } from '@/composables/useNewConversionDialog'
import { orpc } from '@/services/orpc'
import { MIN_LOAD_TIME } from '@/lib/constants'

const route = useRoute()
const router = useRouter()
const { open } = useNewConversionDialog()

// Safely access route param
const projectId = computed(() => (route.params as any).id as string)
const project = ref<{ id: string, name: string } | null>(null)
const conversations = ref<any[]>([])
const isLoading = ref(true)

const loadData = async () => {
  const id = projectId.value
  if (!id) return
  
  isLoading.value = true
  const minLoadTime = new Promise(resolve => setTimeout(resolve, MIN_LOAD_TIME))

  try {
     const [p, convs] = await Promise.all([
       orpc.getProject({ projectId: id }),
       orpc.listConversations({ projectId: id })
     ])
     project.value = p
     conversations.value = convs.sort((a, b) => b.updatedAt - a.updatedAt)
  } catch (e) {
     console.error(e)
  } finally {
     await minLoadTime
     isLoading.value = false
  }
}

const openConversation = (id: string) => {
  router.push(`/conversions/${id}`)
}

watch(projectId, loadData, { immediate: true })
</script>

<template>
  <div class="p-6">
    <Transition name="fade" mode="out-in">
      <div v-if="isLoading" class="flex items-center justify-center py-20">
        <Loader2 class="size-8 animate-spin text-muted-foreground" />
      </div>

      <div v-else>
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
            <ConversionCard
              v-for="conv in conversations"
              :key="conv.id"
              :title="conv.title"
              :project-name="project?.name"
              :updated-at="conv.updatedAt"
              @click="openConversation(conv.id)"
            />
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
    </Transition>
  </div>
</template>
