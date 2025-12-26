<script setup lang="ts">
import { ref } from 'vue'
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
const isLoading = ref(false)

const handleCreate = async () => {
    if (!name.value.trim()) return

    isLoading.value = true
    try {
        await orpc.createProject({
            name: name.value
        })
        window.dispatchEvent(new Event('agent-manager:data-change'))
        emit('created')
        emit('update:open', false)
        name.value = ''
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
                <div class="grid grid-cols-4 items-center gap-4">
                    <Input
                        id="name"
                        v-model="name"
                        placeholder="Project Name"
                        class="col-span-4"
                        @keydown.enter="handleCreate"
                        autoFocus
                    />
                </div>
            </div>
            <DialogFooter>
                <Button type="button" variant="secondary" @click="emit('update:open', false)">
                    Cancel
                </Button>
                <Button type="submit" @click="handleCreate" :disabled="isLoading || !name.trim()">
                    <span v-if="isLoading">Creating...</span>
                    <span v-else>Create Project</span>
                </Button>
            </DialogFooter>
        </DialogContent>
    </Dialog>
</template>
