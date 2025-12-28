<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import { Loader2, Plus, GitBranch, Trash2 } from 'lucide-vue-next'
import { orpc } from '@/services/orpc'

const route = useRoute()
const projectId = (route.params as any).id as string

interface Worktree {
  id: string
  path: string
  branch: string
  isMain: boolean
  isLocked: boolean
  prunable: string | null
}

const worktrees = ref<Worktree[]>([])
const isLoading = ref(false)
const isCreating = ref(false)

// New Worktree Form
const isDialogOpen = ref(false)
const newBranch = ref('')
const newPath = ref('')

const loadWorktrees = async () => {
  isLoading.value = true
  try {
    const res = await orpc.listWorktrees({ projectId })
    worktrees.value = res
  } catch (e) {
    console.error(e)
  } finally {
    isLoading.value = false
  }
}

const createWorktree = async () => {
  if (!newBranch.value) return
  isCreating.value = true
  try {
    await orpc.createWorktree({
      projectId,
      branch: newBranch.value,
      relativePath: newPath.value || undefined
    })
    isDialogOpen.value = false
    newBranch.value = ''
    newPath.value = ''
    await loadWorktrees()
  } catch (e) {
    console.error(e)
  } finally {
    isCreating.value = false
  }
}

const removeWorktree = async (path: string) => {
  if (!confirm('Are you sure you want to remove this worktree? Uncommitted changes may be lost.')) return
  try {
    await orpc.removeWorktree({
      projectId,
      path,
      force: true // Allow force remove for now or make it an option
    })
    await loadWorktrees()
  } catch (e) {
    console.error(e)
    alert('Failed to remove worktree: ' + e)
  }
}

const getWorktreeName = (path: string) => {
    // Basic extraction of the folder name
    return path.split(/[\\/]/).pop() || path
}

onMounted(() => {
  loadWorktrees()
})
</script>

<template>
  <div class="space-y-6">
    <div class="flex items-center justify-between">
      <div>
        <h2 class="text-lg font-semibold flex items-center gap-2">
          <GitBranch class="size-5" />
          Git Worktrees
        </h2>
        <p class="text-sm text-muted-foreground">
          Manage parallel working directories for this project.
        </p>
      </div>
      
      <Dialog v-model:open="isDialogOpen">
        <DialogTrigger as-child>
          <Button>
            <Plus class="size-4 mr-2" />
            Add Worktree
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create New Worktree</DialogTitle>
            <DialogDescription>
              Create a new linked working directory for a specific branch.
            </DialogDescription>
          </DialogHeader>
          <div class="space-y-4 py-4">
            <div class="space-y-2">
              <label class="text-sm font-medium">Branch Name</label>
              <Input v-model="newBranch" placeholder="feature/new-agent-task" />
              <p class="text-xs text-muted-foreground">Existing branch will be checked out, or new one created.</p>
            </div>
            <div class="space-y-2">
              <label class="text-sm font-medium">Directory Path (Optional)</label>
              <Input v-model="newPath" placeholder=".worktrees/task-1" />
              <p class="text-xs text-muted-foreground">Relative to project root. Default: .worktrees/&lt;branch&gt;</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" @click="isDialogOpen = false">Cancel</Button>
            <Button :disabled="!newBranch || isCreating" @click="createWorktree">
              <Loader2 v-if="isCreating" class="size-4 mr-2 animate-spin" />
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>

    <div v-if="isLoading" class="flex justify-center py-8">
      <Loader2 class="size-6 animate-spin text-muted-foreground" />
    </div>

    <div v-else-if="worktrees.length === 0" class="text-center py-8 text-muted-foreground border rounded-lg border-dashed">
      <p>No worktrees found (or not a git repository).</p>
    </div>

    <div v-else class="border rounded-md">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Directory</TableHead>
            <TableHead>Branch</TableHead>
            <TableHead>Status</TableHead>
            <TableHead class="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow v-for="wt in worktrees" :key="wt.id">
            <TableCell class="font-medium">
               <div class="flex flex-col">
                   <span>{{ getWorktreeName(wt.path) }}</span>
                   <span class="text-xs text-muted-foreground truncate max-w-[300px]" :title="wt.path">{{ wt.path }}</span>
               </div>
            </TableCell>
            <TableCell>
                <div class="flex items-center gap-2">
                    <GitBranch class="size-3 text-muted-foreground" />
                    {{ wt.branch }}
                </div>
            </TableCell>
            <TableCell>
              <div class="flex gap-2">
                  <Badge v-if="wt.isMain" variant="default">Main</Badge>
                  <Badge v-if="wt.isLocked" variant="outline">Locked</Badge>
                  <Badge v-if="wt.prunable" variant="destructive">Prunable</Badge>
              </div>
            </TableCell>
            <TableCell class="text-right">
              <Button 
                v-if="!wt.isMain" 
                variant="ghost" 
                size="icon" 
                class="text-destructive hover:text-destructive hover:bg-destructive/10"
                @click="removeWorktree(wt.path)"
              >
                <Trash2 class="size-4" />
              </Button>
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </div>
  </div>
</template>
