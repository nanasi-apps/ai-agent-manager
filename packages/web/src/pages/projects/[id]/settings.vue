<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ArrowLeft, Loader2 } from 'lucide-vue-next'
import { orpc } from '@/services/orpc'
import { MIN_LOAD_TIME } from '@/lib/constants'

const route = useRoute()
const router = useRouter()
const projectId = computed(() => (route.params as any).id as string)
const project = ref<{ id: string, name: string, rootPath?: string } | null>(null)
const nameDraft = ref('')
const rootPathDraft = ref('')
const isLoading = ref(true)
const isSavingProject = ref(false)
const hasNativePicker = computed(() => {
  return typeof window !== 'undefined' && !!window.electronAPI
})

const loadProject = async () => {
  const id = projectId.value
  if (!id) return

  isLoading.value = true
  const minLoadTime = new Promise(resolve => setTimeout(resolve, MIN_LOAD_TIME))

  try {
    const data = await orpc.getProject({ projectId: id })
    project.value = data
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
}

const isSettingsDirty = computed(() => {
  if (!project.value) return false
  return (
    nameDraft.value !== project.value.name ||
    rootPathDraft.value !== (project.value.rootPath || '')
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
    })
    if (result.success) {
      project.value = {
        ...project.value,
        name: trimmedName,
        rootPath: trimmedRoot || undefined,
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
  <div class="p-6">
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

          <div class="mt-4 flex gap-2">
            <Button
              variant="secondary"
              :disabled="isSavingProject || !isSettingsDirty"
              @click="resetSettings"
            >
              Reset
            </Button>
            <Button
              :disabled="isSavingProject || !isSettingsDirty || !nameDraft.trim()"
              @click="saveProjectSettings"
            >
              <span v-if="isSavingProject">Saving...</span>
              <span v-else>Save Settings</span>
            </Button>
          </div>
        </div>
      </div>
    </Transition>
  </div>
</template>
