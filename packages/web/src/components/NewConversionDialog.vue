<script setup lang="ts">
import { ref, watch } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useNewConversionDialog } from '@/composables/useNewConversionDialog'
import { orpc } from '@/services/orpc'

interface Project {
    id: string
    name: string
}

interface AgentTemplate {
    id: string
    name: string
}

const { isOpen, close, projectId: preselectedProjectId } = useNewConversionDialog()
const router = useRouter()
const route = useRoute()

const input = ref('')
const selectedProjectId = ref('')
const selectedAgentType = ref('gemini')
const projects = ref<Project[]>([])
const agentTemplates = ref<AgentTemplate[]>([])
const isLoading = ref(false)
const isInitializing = ref(true)

const loadData = async () => {
    isInitializing.value = true
    try {
        const [projRes, agentRes] = await Promise.all([
            orpc.listProjects({}),
            orpc.listAgentTemplates({})
        ])
        projects.value = projRes
        agentTemplates.value = agentRes

        // Auto-select project logic
        const params = route.params as any
        const routeProjectId = params.id as string | undefined
        
        // Priority: 1. Composable state (Explicit open) 2. Route param 3. Default (first)
        if (preselectedProjectId.value && projects.value.some(p => p.id === preselectedProjectId.value)) {
            selectedProjectId.value = preselectedProjectId.value
        } else if (routeProjectId && projects.value.some(p => p.id === routeProjectId)) {
            selectedProjectId.value = routeProjectId
        } else if (projects.value.length > 0 && !selectedProjectId.value) {
            selectedProjectId.value = projects.value[0]!.id
        }
        
    } catch (e) {
        console.error("Failed to load initial data", e)
    } finally {
        isInitializing.value = false
    }
}


// Reload data when dialog opens
watch(isOpen, (val) => {
    if (val) loadData()
})

const handleStart = async () => {
    if (!input.value.trim() || !selectedProjectId.value || !selectedAgentType.value) return

    isLoading.value = true
    try {
        // Create new session via orpc
        const res = await orpc.createConversation({
            projectId: selectedProjectId.value,
            initialMessage: input.value,
            agentType: selectedAgentType.value
        })
        
        window.dispatchEvent(new Event('agent-manager:data-change'))
        
        close()
        input.value = ''
        
        // Navigate to the new conversion
        router.push(`/conversions/${res.sessionId}`)
    } catch (e) {
        console.error("Failed to start conversation", e)
    } finally {
        isLoading.value = false
    }
}

// Handle CMD+Enter to submit
const handleKeydown = (e: KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        handleStart()
    }
}
</script>

<template>
    <Dialog :open="isOpen" @update:open="(val) => !val && close()">
        <DialogContent class="sm:max-w-md">
            <DialogHeader>
                <DialogTitle>Start New Conversation</DialogTitle>
                <DialogDescription>
                    Select a project and model to start your task.
                </DialogDescription>
            </DialogHeader>
            
            <div class="grid gap-4 py-2">
                <!-- Selectors Row -->
                <div class="grid grid-col-1 sm:grid-cols-2 gap-4">
                    <div class="space-y-2">
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

                    <div class="space-y-2">
                        <label class="text-xs font-medium text-muted-foreground">Model</label>
                        <div class="relative">
                             <select 
                                v-model="selectedAgentType"
                                class="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 appearance-none"
                            >
                                <option v-for="a in agentTemplates" :key="a.id" :value="a.id">
                                    {{ a.name }}
                                </option>
                            </select>
                             <div class="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-muted-foreground">
                                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-4 w-4"><path d="m6 9 6 6 6-6"/></svg>
                            </div>
                        </div>
                    </div>
                </div>

                <div class="space-y-2">
                    <label class="text-xs font-medium text-muted-foreground">Initial Request</label>
                    <Textarea
                        v-model="input"
                        placeholder="Describe your task... (Cmd+Enter to send)"
                        @keydown="handleKeydown"
                        :disabled="isLoading"
                        class="min-h-[100px]"
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
