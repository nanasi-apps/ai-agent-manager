<script setup lang="ts">
import { computed, ref } from 'vue'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { orpc } from '@/services/orpc'

const props = defineProps<{
  open: boolean
}>()

const emit = defineEmits<{
  (e: 'update:open', value: boolean): void
  (e: 'created'): void
}>()

const name = ref('')
const rootPath = ref('')
const isLoading = ref(false)
const hasNativePicker = computed(() => {
  return typeof window !== 'undefined' && !!window.electronAPI
})

const browseRootPath = async () => {
  if (!hasNativePicker.value) return
  try {
    const selected = await orpc.selectDirectory()
    if (selected) {
      rootPath.value = selected
    }
  } catch (e) {
    console.error("Failed to select directory", e)
  }
}

const handleCreate = async () => {
    const trimmedName = name.value.trim()
    const trimmedRoot = rootPath.value.trim()
    if (!trimmedName || !trimmedRoot) return

    isLoading.value = true
    try {
        await orpc.createProject({
            name: trimmedName,
            rootPath: trimmedRoot,
        })
        window.dispatchEvent(new Event('agent-manager:data-change'))
        emit('created')
        emit('update:open', false)
        name.value = ''
        rootPath.value = ''
    } catch (e) {
        console.error("Failed to create project", e)
    } finally {
        isLoading.value = false
    }
}
</script>

<template>
    <Dialog :open="open" @update:open="(val) => emit('update:open', val)">
        <DialogContent class="sm:max-w-md">
            <DialogHeader>
                <DialogTitle>Create New Project</DialogTitle>
                <DialogDescription>
                    Create a project to organize your agent conversions.
                </DialogDescription>
            </DialogHeader>
            <div class="grid gap-4 py-4">
                <div class="space-y-2">
                    <label class="text-xs font-medium text-muted-foreground">Project Name (required)</label>
                    <Input
                        id="name"
                        v-model="name"
                        placeholder="Project Name"
                        @keydown.enter="handleCreate"
                        autoFocus
                    />
                </div>
                <div class="space-y-2">
                    <label class="text-xs font-medium text-muted-foreground">Root Path (required)</label>
                    <div class="flex gap-2">
                        <Input
                            id="rootPath"
                            v-model="rootPath"
                            placeholder="/path/to/project"
                            class="flex-1"
                            @keydown.enter="handleCreate"
                        />
                        <Button
                            variant="secondary"
                            type="button"
                            :disabled="!hasNativePicker || isLoading"
                            @click="browseRootPath"
                        >
                            Browse
                        </Button>
                    </div>
                </div>
            </div>
            <DialogFooter>
                <Button type="button" variant="secondary" @click="emit('update:open', false)">
                    Cancel
                </Button>
                <Button
                    type="submit"
                    @click="handleCreate"
                    :disabled="isLoading || !name.trim() || !rootPath.trim()"
                >
                    <span v-if="isLoading">Creating...</span>
                    <span v-else>Create Project</span>
                </Button>
            </DialogFooter>
        </DialogContent>
    </Dialog>
</template>
