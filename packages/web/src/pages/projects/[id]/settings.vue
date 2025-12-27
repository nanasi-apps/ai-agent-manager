<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Checkbox } from '@/components/ui/checkbox'
import { ScrollArea } from '@/components/ui/scroll-area'
import { ArrowLeft, Loader2, Plus, Trash2, FileText } from 'lucide-vue-next'
import { orpc } from '@/services/orpc'
import { MIN_LOAD_TIME } from '@/lib/constants'

interface ProjectRule {
    id: string
    name: string
    content: string
}

const route = useRoute()
const router = useRouter()
const projectId = computed(() => (route.params as any).id as string)
const project = ref<{ id: string, name: string, rootPath?: string, activeGlobalRules?: string[], projectRules?: ProjectRule[] } | null>(null)
const nameDraft = ref('')
const rootPathDraft = ref('')
const isLoading = ref(true)
const isSavingProject = ref(false)
const hasNativePicker = computed(() => {
  return typeof window !== 'undefined' && !!window.electronAPI
})
const globalRules = ref<{ id: string, name: string }[]>([])
const activeGlobalRulesDraft = ref<string[]>([])
const projectRulesDraft = ref<ProjectRule[]>([])

// Project Rules Logic
const selectedProjectRuleId = ref<string | null>(null)
const selectedRule = computed(() => projectRulesDraft.value.find(r => r.id === selectedProjectRuleId.value))

const createProjectRule = () => {
    const newRule: ProjectRule = {
        id: crypto.randomUUID(),
        name: 'New Rule',
        content: ''
    }
    projectRulesDraft.value.push(newRule)
    selectedProjectRuleId.value = newRule.id
}

const deleteProjectRule = (id: string, event?: Event) => {
    event?.stopPropagation()
    if (!confirm('Are you sure you want to delete this rule?')) return
    
    projectRulesDraft.value = projectRulesDraft.value.filter(r => r.id !== id)
    if (selectedProjectRuleId.value === id) {
        selectedProjectRuleId.value = null
    }
}

const loadProject = async () => {
  const id = projectId.value
  if (!id) return

  isLoading.value = true
  const minLoadTime = new Promise(resolve => setTimeout(resolve, MIN_LOAD_TIME))

  try {
    const [p, rules] = await Promise.all([
        orpc.getProject({ projectId: id }),
        orpc.listGlobalRules()
    ])
    // Ensure projectRules is parsed correctly or initialized
    const parsedProject = {
        ...p,
        // @ts-ignore
        projectRules: (p?.projectRules && Array.isArray(p.projectRules)) ? p.projectRules : []
    }
    project.value = parsedProject as any
    globalRules.value = rules
  } catch (e) {
    console.error(e)
  } finally {
    await minLoadTime
    isLoading.value = false
  }
}

const resetSettings = () => {
  nameDraft.value = project.value?.name || ''
  rootPathDraft.value = project.value?.rootPath || ''
  activeGlobalRulesDraft.value = project.value?.activeGlobalRules ? [...project.value.activeGlobalRules] : []
  // Deep copy project rules
  projectRulesDraft.value = project.value?.projectRules ? JSON.parse(JSON.stringify(project.value.projectRules)) : []
  selectedProjectRuleId.value = null
}

const isSettingsDirty = computed(() => {
  if (!project.value) return false
  return (
    nameDraft.value !== project.value.name ||
    rootPathDraft.value !== (project.value.rootPath || '') ||
    JSON.stringify(activeGlobalRulesDraft.value.sort()) !== JSON.stringify((project.value.activeGlobalRules || []).sort()) ||
    projectRulesDraft.value.length !== (project.value.projectRules || []).length ||
    JSON.stringify(projectRulesDraft.value.map(r => ({ name: r.name, content: r.content })).sort((a,b) => a.name.localeCompare(b.name))) !== 
    JSON.stringify((project.value.projectRules || []).map(r => ({ name: r.name, content: r.content })).sort((a,b) => a.name.localeCompare(b.name)))
  )
})

const saveProjectSettings = async () => {
  if (!project.value) return
  const trimmedName = nameDraft.value.trim()
  if (!trimmedName) return

  const trimmedRoot = rootPathDraft.value.trim()

  isSavingProject.value = true
  try {
    const result = await orpc.updateProject({
      projectId: projectId.value,
      name: trimmedName,
      rootPath: trimmedRoot ? trimmedRoot : null,
      activeGlobalRules: activeGlobalRulesDraft.value,
      projectRules: projectRulesDraft.value
    })
    if (result.success) {
      project.value = {
        ...project.value,
        name: trimmedName,
        rootPath: trimmedRoot || undefined,
        activeGlobalRules: activeGlobalRulesDraft.value,
        projectRules: JSON.parse(JSON.stringify(projectRulesDraft.value))
      }
      window.dispatchEvent(new Event('agent-manager:data-change'))
    }
  } catch (e) {
    console.error(e)
  } finally {
    isSavingProject.value = false
  }
}

const browseRootPath = async () => {
  if (!hasNativePicker.value) return
  try {
    const selected = await orpc.selectDirectory()
    if (selected) {
      rootPathDraft.value = selected
    }
  } catch (e) {
    console.error(e)
  }
}

watch(project, () => {
  resetSettings()
})

watch(projectId, loadProject, { immediate: true })
</script>

<template>
  <div class="p-6 pb-24">
    <Transition name="fade" mode="out-in">
      <div v-if="isLoading" class="flex items-center justify-center py-20">
        <Loader2 class="size-8 animate-spin text-muted-foreground" />
      </div>

      <div v-else>
        <div class="flex items-center justify-between mb-8">
          <div>
            <h1 class="text-2xl font-bold">Project Settings</h1>
            <p class="text-muted-foreground">
              {{ project?.name || projectId }}
            </p>
          </div>
          <Button variant="secondary" @click="router.push(`/projects/${projectId}`)">
            <ArrowLeft class="w-4 h-4 mr-2" />
            Back
          </Button>
        </div>

        <div class="border rounded-lg p-4 bg-card/60">
          <div class="mt-1 grid gap-4 md:grid-cols-2">
            <div class="space-y-2">
              <label class="text-sm font-medium">Name</label>
              <Input v-model="nameDraft" placeholder="Project name" />
            </div>
            <div class="space-y-2">
              <label class="text-sm font-medium">Root path</label>
              <div class="flex gap-2">
                <Input v-model="rootPathDraft" placeholder="/path/to/project" class="flex-1" />
                <Button
                  variant="secondary"
                  type="button"
                  :disabled="!hasNativePicker || isSavingProject"
                  @click="browseRootPath"
                >
                  Browse
                </Button>
              </div>
            </div>
          </div>
        </div>

        <div class="mt-6 border rounded-lg p-4 bg-card/60">
             <h2 class="text-lg font-semibold mb-4">Rules</h2>
             
             <div class="space-y-6">
                 <!-- Global Rules Section -->
                 <div>
                     <h3 class="text-sm font-medium mb-3">Global Rules</h3>
                     <div v-if="globalRules.length > 0" class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                         <div v-for="rule in globalRules" :key="rule.id" class="flex items-center space-x-2 border p-3 rounded-md bg-background">
                             <Checkbox 
                                 :id="`rule-${rule.id}`" 
                                 :checked="activeGlobalRulesDraft.includes(rule.id)"
                                 @update:checked="(checked: any) => {
                                     if (checked) {
                                         activeGlobalRulesDraft.push(rule.id)
                                     } else {
                                         activeGlobalRulesDraft = activeGlobalRulesDraft.filter(id => id !== rule.id)
                                     }
                                 }"
                             />
                             <label
                                 :for="`rule-${rule.id}`"
                                 class="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer select-none"
                             >
                                 {{ rule.name }}
                             </label>
                         </div>
                     </div>
                     <p v-else class="text-sm text-muted-foreground italic">No global rules defined.</p>
                 </div>

                 <!-- Project Specific Rules Master-Detail View -->
                 <div>
                     <label class="text-sm font-medium mb-2 block">Project Specific Rules</label>
                     <div class="flex h-[500px] border rounded-md overflow-hidden bg-background">
                        <!-- Sidebar List -->
                        <div class="w-64 border-r flex flex-col bg-muted/10">
                            <div class="p-3 border-b flex items-center justify-between">
                                <span class="text-xs font-semibold text-muted-foreground uppercase">Rules List</span>
                                <Button size="icon" variant="ghost" class="h-6 w-6" @click="createProjectRule">
                                    <Plus class="size-4" />
                                </Button>
                            </div>
                            <ScrollArea class="flex-1">
                                <div class="p-2 space-y-1">
                                    <button 
                                        v-for="rule in projectRulesDraft" 
                                        :key="rule.id"
                                        @click="selectedProjectRuleId = rule.id"
                                        :class="['w-full group flex items-center gap-2 px-2 py-1.5 text-sm rounded-md transition-colors text-left outline-none', selectedProjectRuleId === rule.id ? 'bg-accent text-accent-foreground' : 'hover:bg-muted/50 text-muted-foreground hover:text-foreground']"
                                    >
                                        <FileText class="size-3.5 opacity-70" />
                                        <span class="truncate flex-1">{{ rule.name }}</span>
                                        <div 
                                            class="opacity-0 group-hover:opacity-100 transition-opacity"
                                            @click.stop="deleteProjectRule(rule.id, $event)"
                                        >
                                            <Trash2 class="size-3.5 text-muted-foreground hover:text-destructive" />
                                        </div>
                                    </button>
                                </div>
                            </ScrollArea>
                        </div>
                        
                        <div class="flex-1 flex flex-col min-w-0" v-if="selectedRule">
                             <div class="p-4 border-b flex flex-col gap-1 bg-muted/5">
                                 <label class="text-xs font-medium text-muted-foreground">Rule Name</label>
                                 <Input v-model="selectedRule.name" class="font-medium" placeholder="Rule Name" />
                             </div>
                             <div class="flex-1 relative">
                                 <Textarea 
                                     v-model="selectedRule.content" 
                                     placeholder="Write your rule logic here (Markdown)..."
                                     class="w-full h-full absolute inset-0 border-0 rounded-none resize-none focus-visible:ring-0 p-4 font-mono text-sm leading-relaxed" 
                                 />
                             </div>
                        </div>
                        
                        <!-- Empty State -->
                        <div v-else class="flex-1 flex items-center justify-center text-muted-foreground bg-muted/5">
                            <div class="text-center">
                                <FileText class="size-10 mx-auto mb-3 opacity-20" />
                                <p class="text-sm">Select or create a rule to edit</p>
                            </div>
                        </div>
                     </div>
                 </div>
             </div>
        </div>
      </div>
    </Transition>

    <!-- Floating Save Bar -->
    <Transition name="slide-up">
        <div v-if="isSettingsDirty" class="fixed bottom-6 right-6 z-50 flex gap-2">
            <div class="bg-popover text-popover-foreground border shadow-lg rounded-lg p-2 flex items-center gap-2">
                <span class="text-sm font-medium px-2 text-muted-foreground">Unsaved changes</span>
                <Button variant="ghost" size="sm" @click="resetSettings" :disabled="isSavingProject">Discard</Button>
                <Button size="sm" @click="saveProjectSettings" :disabled="isSavingProject || !nameDraft.trim()">
                    {{ isSavingProject ? 'Saving...' : 'Save All Changes' }}
                </Button>
            </div>
        </div>
    </Transition>
  </div>
</template>

<style scoped>
.slide-up-enter-active,
.slide-up-leave-active {
  transition: all 0.3s ease;
}

.slide-up-enter-from,
.slide-up-leave-to {
  transform: translateY(20px);
  opacity: 0;
}
</style>
