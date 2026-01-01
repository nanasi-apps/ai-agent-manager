<script setup lang="ts">
import { GitBranch, Loader2, Plus, Trash2 } from "lucide-vue-next";
import { computed, onMounted, ref } from "vue";
import { useRoute } from "vue-router";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { getRouteParamFrom } from "@/lib/route-params";
import { orpc } from "@/services/orpc";

const route = useRoute();
const projectId = computed(() => getRouteParamFrom(route.params, "id"));

interface Worktree {
	id: string;
	path: string;
	branch: string;
	isMain: boolean;
	isLocked: boolean;
	prunable: string | null;
}

interface WorktreeCommit {
	hash: string;
	shortHash: string;
	author: string;
	date: string;
	subject: string;
}

const worktrees = ref<Worktree[]>([]);
const isLoading = ref(false);
const isCreating = ref(false);
const selectedWorktree = ref<Worktree | null>(null);
const worktreeCommits = ref<WorktreeCommit[]>([]);
const isDetailLoading = ref(false);

// New Worktree Form
const isDialogOpen = ref(false);
const newBranch = ref("");
const newPath = ref("");

const loadWorktrees = async () => {
	const id = projectId.value;
	if (!id) return;
	isLoading.value = true;
	try {
		const res = await orpc.listWorktrees({ projectId: id });
		worktrees.value = res;
		if (res.length > 0) {
			const existing = selectedWorktree.value;
			const found = existing
				? res.find((wt) => wt.path === existing.path)
				: undefined;
			const target = found || res[0];
			if (target) {
				await selectWorktree(target);
			}
		} else {
			selectedWorktree.value = null;
			worktreeCommits.value = [];
		}
	} catch (e) {
		console.error(e);
	} finally {
		isLoading.value = false;
	}
};

const loadWorktreeDetails = async (worktree: Worktree) => {
	const id = projectId.value;
	if (!id) return;
	isDetailLoading.value = true;
	try {
		const commits = await orpc.listWorktreeCommits({
			projectId: id,
			path: worktree.path,
			limit: 15,
		});
		worktreeCommits.value = commits;
	} catch (e) {
		console.error(e);
	} finally {
		isDetailLoading.value = false;
	}
};

const selectWorktree = async (worktree: Worktree) => {
	selectedWorktree.value = worktree;
	await loadWorktreeDetails(worktree);
};

const createWorktree = async () => {
	const id = projectId.value;
	if (!id) return;
	if (!newBranch.value) return;
	isCreating.value = true;
	try {
		await orpc.createWorktree({
			projectId: id,
			branch: newBranch.value,
			relativePath: newPath.value || undefined,
		});
		isDialogOpen.value = false;
		newBranch.value = "";
		newPath.value = "";
		await loadWorktrees();
	} catch (e) {
		console.error(e);
	} finally {
		isCreating.value = false;
	}
};

const removeWorktree = async (path: string) => {
	const id = projectId.value;
	if (!id) return;
	if (
		!confirm(
			"Are you sure you want to remove this worktree? Uncommitted changes may be lost.",
		)
	)
		return;
	try {
		await orpc.removeWorktree({
			projectId: id,
			path,
			force: true, // Allow force remove for now or make it an option
		});
		await loadWorktrees();
	} catch (e) {
		console.error(e);
		alert("Failed to remove worktree: " + e);
	}
};

const getWorktreeName = (path: string) => {
	// Basic extraction of the folder name
	return path.split(/[\\/]/).pop() || path;
};

const formatCommitDate = (value: string) => {
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return value;
	return date.toLocaleString();
};

onMounted(() => {
	loadWorktrees();
});
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
      <Table class="table-fixed">
        <TableHeader>
          <TableRow>
            <TableHead class="w-[50%]">Directory</TableHead>
            <TableHead class="w-[40%]">Branch</TableHead>
            <TableHead class="w-[10%] text-right">Actions</TableHead>
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
            <TableCell class="font-medium overflow-hidden">
               <div class="flex flex-col min-w-0">
                   <span class="truncate">{{ getWorktreeName(wt.path) }}</span>
                   <span class="text-xs text-muted-foreground truncate" :title="wt.path">{{ wt.path }}</span>
               </div>
            </TableCell>
            <TableCell class="overflow-hidden">
                <div class="flex items-center gap-2 min-w-0">
                    <span class="shrink-0">
                      <GitBranch class="size-3 text-muted-foreground" />
                    </span>
                    <span class="truncate">{{ wt.branch }}</span>
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

    <div v-if="selectedWorktree" class="min-w-0">
      <Card class="min-w-0">
        <CardHeader>
          <CardTitle class="flex items-center gap-2">
            Micro-commit Log
            <Badge variant="secondary" class="font-normal truncate max-w-[300px]" :title="selectedWorktree.branch">
              {{ selectedWorktree.branch }}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div v-if="isDetailLoading" class="text-sm text-muted-foreground flex items-center gap-2">
            <Loader2 class="size-4 animate-spin" />
            Loading commits...
          </div>
          <div v-else-if="worktreeCommits.length" class="space-y-3">
            <ScrollArea class="h-80 pr-2">
              <div class="space-y-3">
                <div v-for="commit in worktreeCommits" :key="commit.hash" class="rounded-md border p-3 min-w-0 overflow-hidden">
                  <div class="flex items-center gap-2 min-w-0">
                    <Badge variant="outline" class="shrink-0">{{ commit.shortHash }}</Badge>
                    <span class="text-sm font-medium truncate" :title="commit.subject">{{ commit.subject }}</span>
                  </div>
                  <div class="mt-1 text-xs text-muted-foreground truncate">
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
