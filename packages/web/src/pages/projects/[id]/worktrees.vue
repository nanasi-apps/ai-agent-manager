<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
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

interface WorktreeStatusEntry {
  path: string
  status: string
}

interface WorktreeStatus {
  branch: string
  upstream?: string
  ahead: number
  behind: number
  entries: WorktreeStatusEntry[]
  raw: string
}

interface WorktreeDiff {
  text: string
  hasChanges: boolean
  untracked: string[]
}

interface WorktreeCommit {
  hash: string
  shortHash: string
  author: string
  date: string
  subject: string
}

const worktrees = ref<Worktree[]>([])
const isLoading = ref(false)
const isCreating = ref(false)
const selectedWorktree = ref<Worktree | null>(null)
const worktreeStatus = ref<WorktreeStatus | null>(null)
const worktreeDiff = ref<WorktreeDiff | null>(null)
const worktreeCommits = ref<WorktreeCommit[]>([])
const isDetailLoading = ref(false)

// New Worktree Form
const isDialogOpen = ref(false)
const newBranch = ref('')
const newPath = ref('')

const loadWorktrees = async () => {
  isLoading.value = true
  try {
    const res = await orpc.listWorktrees({ projectId })
    worktrees.value = res
    if (res.length > 0) {
      const existing = selectedWorktree.value
      const found = existing ? res.find(wt => wt.path === existing.path) : undefined
      const target = found || res[0]
      if (target) {
        await selectWorktree(target)
      }
    } else {
      selectedWorktree.value = null
      worktreeStatus.value = null
      worktreeDiff.value = null
      worktreeCommits.value = []
    }
  } catch (e) {
    console.error(e)
  } finally {
    isLoading.value = false
  }
}

const loadWorktreeDetails = async (worktree: Worktree) => {
  isDetailLoading.value = true
  try {
    const [status, diff, commits] = await Promise.all([
      orpc.getWorktreeStatus({ projectId, path: worktree.path }),
      orpc.getWorktreeDiff({ projectId, path: worktree.path }),
      orpc.listWorktreeCommits({ projectId, path: worktree.path, limit: 15 })
    ])
    worktreeStatus.value = status
    worktreeDiff.value = diff
    worktreeCommits.value = commits
  } catch (e) {
    console.error(e)
  } finally {
    isDetailLoading.value = false
  }
}

const selectWorktree = async (worktree: Worktree) => {
  selectedWorktree.value = worktree
  await loadWorktreeDetails(worktree)
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

const formatCommitDate = (value: string) => {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString()
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
          <TableRow
            v-for="wt in worktrees"
            :key="wt.id"
            class="cursor-pointer"
            :class="selectedWorktree?.path === wt.path ? 'bg-muted/40' : ''"
            @click="selectWorktree(wt)"
          >
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
                @click.stop="removeWorktree(wt.path)"
              >
                <Trash2 class="size-4" />
              </Button>
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </div>

    <div v-if="selectedWorktree" class="grid gap-6 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
      <Card>
        <CardHeader>
          <CardTitle>Worktree Snapshot</CardTitle>
        </CardHeader>
        <CardContent class="space-y-4">
          <div class="flex flex-wrap items-center gap-2">
            <Badge variant="secondary">{{ selectedWorktree.branch }}</Badge>
            <Badge v-if="worktreeStatus?.ahead" variant="outline">Ahead {{ worktreeStatus.ahead }}</Badge>
            <Badge v-if="worktreeStatus?.behind" variant="outline">Behind {{ worktreeStatus.behind }}</Badge>
            <Badge v-if="selectedWorktree.isMain">Main</Badge>
            <Badge v-if="selectedWorktree.isLocked" variant="outline">Locked</Badge>
          </div>

          <Separator />

          <div class="space-y-2">
            <div class="text-sm font-medium">Status</div>
            <div v-if="isDetailLoading" class="text-sm text-muted-foreground flex items-center gap-2">
              <Loader2 class="size-4 animate-spin" />
              Loading status...
            </div>
            <div v-else-if="worktreeStatus?.entries.length" class="space-y-2">
              <div class="text-xs text-muted-foreground">
                {{ worktreeStatus.entries.length }} change(s)
              </div>
              <div class="grid gap-2 md:grid-cols-2">
                <div
                  v-for="entry in worktreeStatus.entries"
                  :key="entry.path"
                  class="rounded-md border px-3 py-2 text-xs"
                >
                  <div class="font-medium">{{ entry.status }}</div>
                  <div class="truncate text-muted-foreground" :title="entry.path">{{ entry.path }}</div>
                </div>
              </div>
            </div>
            <div v-else class="text-sm text-muted-foreground">
              Working tree clean.
            </div>
          </div>

          <Separator />

          <div class="space-y-2">
            <div class="text-sm font-medium">Working Diff</div>
            <div v-if="isDetailLoading" class="text-sm text-muted-foreground flex items-center gap-2">
              <Loader2 class="size-4 animate-spin" />
              Loading diff...
            </div>
            <div v-else-if="worktreeDiff?.hasChanges">
              <ScrollArea class="h-56 rounded-md border p-3">
                <pre class="text-xs font-mono whitespace-pre-wrap">{{ worktreeDiff?.text || '' }}</pre>
              </ScrollArea>
              <div v-if="worktreeDiff?.untracked.length" class="mt-3 text-xs text-muted-foreground">
                Untracked: {{ worktreeDiff.untracked.join(', ') }}
              </div>
            </div>
            <div v-else class="text-sm text-muted-foreground">
              No changes detected.
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Micro-commit Log</CardTitle>
        </CardHeader>
        <CardContent>
          <div v-if="isDetailLoading" class="text-sm text-muted-foreground flex items-center gap-2">
            <Loader2 class="size-4 animate-spin" />
            Loading commits...
          </div>
          <div v-else-if="worktreeCommits.length" class="space-y-3">
            <ScrollArea class="h-80 pr-2">
              <div class="space-y-3">
                <div v-for="commit in worktreeCommits" :key="commit.hash" class="rounded-md border p-3">
                  <div class="flex items-center gap-2">
                    <Badge variant="outline">{{ commit.shortHash }}</Badge>
                    <span class="text-sm font-medium truncate">{{ commit.subject }}</span>
                  </div>
                  <div class="mt-1 text-xs text-muted-foreground">
                    {{ commit.author }} · {{ formatCommitDate(commit.date) }}
                  </div>
                </div>
              </div>
            </ScrollArea>
          </div>
          <div v-else class="text-sm text-muted-foreground">
            No recent commits found.
          </div>
        </CardContent>
      </Card>
    </div>
  </div>
</template>
