<script setup lang="ts">
import { GitBranch, Loader2, Trash2 } from "lucide-vue-next";
import { computed, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { getRouteParamFrom } from "@/lib/route-params";
import { orpcQuery } from "@/services/orpc";
import type { Worktree } from "@agent-manager/shared";

const route = useRoute();
const router = useRouter();
const projectId = computed(() => getRouteParamFrom(route.params, "id"));


const worktrees = ref<Worktree[]>([]);
const isLoading = ref(false);
const selectedPaths = ref<string[]>([]);

const selectablePaths = computed(() =>
  worktrees.value.filter(wt => !wt.isMain).map(wt => wt.path),
);

const isAllSelected = computed(() => {
  if (selectablePaths.value.length === 0) return false;

  const selectedCount = selectablePaths.value.filter(path =>
    selectedPaths.value.includes(path),
  ).length;
  if (selectedCount === 0) return false;
  if (selectedCount === selectablePaths.value.length) return true;
  return "indeterminate";
});

const handleSelectAllToggle = (checked: boolean | "indeterminate") => {
  selectedPaths.value = checked === true ? [...selectablePaths.value] : [];
};

const toggleSelection = (path: string, checked: boolean | 'indeterminate') => {
  if (checked === true) {
    if (!selectedPaths.value.includes(path)) {
      selectedPaths.value = [...selectedPaths.value, path];
    }
  } else {
    selectedPaths.value = selectedPaths.value.filter(p => p !== path);
  }
};

const removeSelectedWorktrees = async () => {
    const id = projectId.value;
    if (!id) return;
    
    const count = selectedPaths.value.length;
    if (count === 0) return;
    
    if (
        !confirm(
            `Are you sure you want to remove ${count} worktree(s)? Uncommitted changes may be lost.`,
        )
    )
        return;

    try {
        await Promise.all(selectedPaths.value.map(path => 
            orpcQuery.removeWorktree.call({
                projectId: id,
                path,
                force: true, 
            })
        ));
        selectedPaths.value = [];
        await loadWorktrees();
    } catch (e) {
        console.error(e);
        alert("Failed to remove some worktrees: " + e);
        await loadWorktrees();
    }
};

const loadWorktrees = async () => {
	const id = projectId.value;
	if (!id) return;
	isLoading.value = true;
	try {
		const res = await orpcQuery.listWorktrees.call({ projectId: id });
		worktrees.value = res;
		
		// Cleanup selected paths
		const existingPaths = res.map(wt => wt.path);
		selectedPaths.value = selectedPaths.value.filter(p => existingPaths.includes(p));

	} catch (e) {
		console.error(e);
	} finally {
		isLoading.value = false;
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
		await orpcQuery.removeWorktree.call({
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

const goToConversation = (conversationId: string) => {
	router.push(`/conversions/${conversationId}`);
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
      
    </div>

    <div v-if="isLoading" class="flex justify-center py-8">
      <Loader2 class="size-6 animate-spin text-muted-foreground" />
    </div>

    <div v-else-if="worktrees.length === 0" class="text-center py-8 text-muted-foreground border rounded-lg border-dashed">
      <p>No worktrees found (or not a git repository).</p>
    </div>

    <template v-else>
      <div v-if="selectedPaths.length > 0" class="flex items-center gap-2 bg-muted/40 p-2 rounded-md mb-2">
        <span class="text-sm text-muted-foreground">{{ selectedPaths.length }} selected</span>
        <div class="flex-1" />
        <Button 
          variant="destructive" 
          size="sm"
          @click="removeSelectedWorktrees"
        >
          <Trash2 class="size-4 mr-2" />
          Delete Selected
        </Button>
      </div>

      <div class="border rounded-md">
        <Table class="table-fixed">
          <TableHeader>
            <TableRow>
              <TableHead class="w-[50px]">
                <Checkbox 
                  :model-value="isAllSelected"
                  @update:model-value="handleSelectAllToggle"
                />
              </TableHead>
              <TableHead class="w-[35%]">Directory</TableHead>
              <TableHead class="w-[25%]">Branch</TableHead>
              <TableHead class="w-[25%]">Conversation</TableHead>
              <TableHead class="w-[10%] text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow
              v-for="wt in worktrees"
              :key="wt.id"
              class="cursor-default"
            >
              <TableCell class="w-[50px]" @click.stop>
                <Checkbox 
                  :model-value="selectedPaths.includes(wt.path)"
                  @update:model-value="(val: boolean | 'indeterminate') => toggleSelection(wt.path, val)"
                  :disabled="wt.isMain"
                />
              </TableCell>
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
              <TableCell class="overflow-hidden">
                <div class="flex flex-col min-w-0">
                  <span
                    v-if="(wt.conversations?.length ?? 0) === 0"
                    class="text-sm text-muted-foreground"
                  >
                    None
                  </span>
                  <button
                    v-for="conv in wt.conversations ?? []"
                    :key="conv.id"
                    class="text-sm text-left truncate text-primary hover:underline"
                    :title="conv.title || 'Untitled Session'"
                    @click.stop="goToConversation(conv.id)"
                  >
                    {{ conv.title || "Untitled Session" }}
                  </button>
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
    </template>

  </div>
</template>
