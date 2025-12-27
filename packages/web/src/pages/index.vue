<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { orpc } from '@/services/orpc'
import { 
  MessageSquare, 
  Sparkles, 
  Cpu,
  Terminal,
  Loader2,
} from 'lucide-vue-next'
import { Button } from '@/components/ui/button'
import { Card, CardHeader, CardTitle } from '@/components/ui/card'
import ConversionCard from '@/components/ConversionCard.vue'
import { 
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { MIN_LOAD_TIME } from '@/lib/constants'

// Project from API - user-created projects
interface UserProject {
  id: string
  name: string
  description?: string
  createdAt: number
  updatedAt: number
}

// Agent template with full config
interface ModelTemplate {
  id: string
  name: string
  agentType: string
  agentName: string
  model?: string
}

interface Conversation {
  id: string
  projectId: string
  title: string
  createdAt: number
  updatedAt: number
}

const router = useRouter()

const userProjects = ref<UserProject[]>([])
const modelTemplates = ref<ModelTemplate[]>([])
const recentConversations = ref<Conversation[]>([])
const isLoading = ref(true)

const dialogOpen = ref(false)
const selectedProject = ref<UserProject | null>(null)
const selectedModel = ref<ModelTemplate | null>(null)
const initialMessage = ref('')
const isCreating = ref(false)

const agentIcons: Record<string, typeof Sparkles> = {
  gemini: Sparkles,
  claude: Cpu,
  codex: Terminal,
  cat: MessageSquare,
  default: MessageSquare,
  custom: Terminal,
}

const agentColors: Record<string, string> = {
  gemini: 'bg-blue-500/10 text-blue-500 border-blue-500/20',
  claude: 'bg-orange-500/10 text-orange-500 border-orange-500/20',
  codex: 'bg-green-500/10 text-green-500 border-green-500/20',
  cat: 'bg-gray-500/10 text-gray-500 border-gray-500/20',
  default: 'bg-gray-500/10 text-gray-500 border-gray-500/20',
  custom: 'bg-purple-500/10 text-purple-500 border-purple-500/20',
}

const loadData = async () => {
  isLoading.value = true
  const minLoadTime = new Promise(resolve => setTimeout(resolve, MIN_LOAD_TIME))
  try {
    const [projectsData, conversationsData, templatesData] = await Promise.all([
      orpc.listProjects({}),
      orpc.listConversations({}),
      orpc.listModelTemplates({})
    ])
    userProjects.value = projectsData
    modelTemplates.value = templatesData
    // Get most recent 5 conversations
    recentConversations.value = conversationsData
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, 5)
  } catch (err) {
    console.error('Failed to load data:', err)
  } finally {
    await minLoadTime
    isLoading.value = false
  }
}

const openNewModelConversation = (model: ModelTemplate) => {
  if (userProjects.value.length === 0) {
    alert('Create a project and set its root path before starting a conversation.')
    return
  }
  selectedModel.value = model
  // Use first project; require a project to exist
  selectedProject.value = userProjects.value[0] || null
  initialMessage.value = ''
  dialogOpen.value = true
}

const createConversation = async () => {
  if (!selectedModel.value || !initialMessage.value.trim()) return
  
  // Require a project selection before starting
  let projectId = selectedProject.value?.id
  if (!projectId) {
    alert('Select or create a project with a root path before starting a conversation.')
    return
  }
  
  isCreating.value = true
  try {
    console.log('Creating conversation...', projectId, selectedModel.value.id, initialMessage.value.trim())
    const result = await orpc.createConversation({
      projectId,
      initialMessage: initialMessage.value.trim(),
      modelId: selectedModel.value.id
    })
    console.log('Conversation created:', result)
    dialogOpen.value = false
    router.push(`/conversions/${result.sessionId}`)
  } catch (err) {
    console.error('Failed to create conversation:', err)
    alert(`Failed to create conversation: ${err}`)
  } finally {
    isCreating.value = false
  }
}

const openConversation = (id: string) => {
  router.push(`/conversions/${id}`)
}

const getProjectName = (projectId: string) => {
  return userProjects.value.find(p => p.id === projectId)?.name || projectId
}

onMounted(() => {
  loadData()
})
</script>

<template>
  <div class="p-6 space-y-8">
    <!-- Header -->
    <div class="space-y-2">
      <h1 class="text-3xl font-bold tracking-tight">Dashboard</h1>
      <p class="text-muted-foreground">Start a new conversation or continue a recent one.</p>
    </div>
    
    <!-- Loading State -->
    <Transition name="fade" mode="out-in">
      <!-- Loading State -->
      <div v-if="isLoading" class="flex items-center justify-center py-20">
        <Loader2 class="size-8 animate-spin text-muted-foreground" />
      </div>

      <div v-else>
        <!-- Agent Selection -->
        <section class="space-y-4">
          <div class="flex items-center justify-between">
            <h2 class="text-xl font-semibold">New Conversation</h2>
          </div>
          
          <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <Card 
              v-for="model in modelTemplates" 
              :key="model.id"
              class="cursor-pointer transition-all hover:shadow-lg hover:scale-[1.02] hover:border-primary/50"
              @click="openNewModelConversation(model)"
            >
              <CardHeader class="pb-3">
                <div class="flex items-center gap-3">
                  <div 
                    class="p-2 rounded-lg border"
                    :class="agentColors[model.agentType] || agentColors.custom"
                  >
                    <component 
                      :is="agentIcons[model.agentType] || agentIcons.custom" 
                      class="size-5"
                    />
                  </div>
                  <div>
                    <CardTitle class="text-base">{{ model.name }}</CardTitle>
                    <Badge variant="outline" class="mt-1 text-xs">
                      {{ model.agentName }}
                    </Badge>
                  </div>
                </div>
              </CardHeader>
            </Card>
          </div>
        </section>

        <!-- Recent Conversations -->
        <section v-if="recentConversations.length > 0" class="space-y-4 mt-8">
          <h2 class="text-xl font-semibold">Recent Conversations</h2>
          
          <div class="space-y-2">
            <ConversionCard
              v-for="conv in recentConversations"
              :key="conv.id"
              :title="conv.title"
              :project-name="getProjectName(conv.projectId)"
              :updated-at="conv.updatedAt"
              @click="openConversation(conv.id)"
            />
          </div>
        </section>

        <!-- Empty State for Recent -->
        <section v-else class="text-center py-12 text-muted-foreground mt-8">
          <MessageSquare class="size-12 mx-auto mb-4 opacity-20" />
          <p>No recent conversations. Start one above!</p>
        </section>
      </div>
    </Transition>

    <!-- New Conversation Dialog -->
    <Dialog v-model:open="dialogOpen">
      <DialogContent class="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle class="flex items-center gap-2">
            <component 
              v-if="selectedModel"
              :is="agentIcons[selectedModel.agentType] || agentIcons.custom" 
              class="size-5"
            />
            New Conversation with {{ selectedModel?.name }}
          </DialogTitle>
          <DialogDescription>
            Enter your first message to start the conversation.
          </DialogDescription>
        </DialogHeader>
        
        <div class="py-4">
          <Textarea
            v-model="initialMessage"
            placeholder="What would you like to discuss?"
            class="min-h-[120px]"
            :disabled="isCreating"
            @keydown.ctrl.enter="createConversation"
            @keydown.meta.enter="createConversation"
          />
          <p class="text-xs text-muted-foreground mt-2">
            Press Cmd+Enter to start
          </p>
        </div>
        
        <DialogFooter>
          <Button variant="outline" @click="dialogOpen = false" :disabled="isCreating">
            Cancel
          </Button>
          <Button @click="createConversation" :disabled="!initialMessage.trim() || isCreating">
            <Loader2 v-if="isCreating" class="size-4 mr-2 animate-spin" />
            Start Conversation
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>
</template>
