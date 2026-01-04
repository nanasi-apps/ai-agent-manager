<script setup lang="ts">
import { computed, onMounted } from "vue";
import { Bell, Loader2, Wand2 } from "lucide-vue-next";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useBranchNameDialogStore } from "@/stores/branchNameDialog";
import { useProjectsStore } from "@/stores/projects";

const store = useBranchNameDialogStore();
const projectsStore = useProjectsStore();

const request = computed(() => store.activeRequest);
const projectName = computed(() => {
	if (!request.value?.projectId) return null;
	return (
		projectsStore.projects.find((p) => p.id === request.value?.projectId)
			?.name ?? null
	);
});

onMounted(() => {
	if (projectsStore.projects.length === 0) {
		void projectsStore.loadProjects();
	}
});

const generationLabel = computed(() => {
	if (store.generationState === "generating") return "生成中...";
	if (store.generationState === "regenerating") return "再生成中...";
	if (store.generationState === "ready") return "生成完了";
	return "AIで提案";
});

const statusLabel = computed(() => {
	switch (store.generationState) {
		case "generating":
			return "生成中";
		case "regenerating":
			return "再生成中";
		case "ready":
			return "生成完了";
		default:
			return "未生成";
	}
});
</script>

<template>
  <Dialog :open="store.isOpen" @update:open="(val) => !val && store.close()">
    <DialogContent class="max-w-xl">
      <DialogHeader>
        <DialogTitle>Choose a branch name for this worktree</DialogTitle>
        <DialogDescription>
          通知をクリックするとこのダイアログが開きます。機能や修正内容が伝わるブランチ名を決め、完了すると自動で作業を始めます。
        </DialogDescription>
      </DialogHeader>

      <div v-if="request" class="space-y-4">
        <div class="rounded-md border bg-muted/40 p-3">
          <div class="flex items-start gap-2 text-sm">
            <Bell class="mt-0.5 h-4 w-4 text-muted-foreground" />
            <div class="space-y-1">
              <div class="font-medium text-foreground">Worktree branch required</div>
              <p class="text-muted-foreground">
                このブランチ名でworktreeを作成します。完了を押すと作業が自動で再開します。
              </p>
              <p class="text-xs text-muted-foreground">
                {{ projectName || "Repository" }} · {{ request.repoPath }}
              </p>
              <p v-if="request.summary" class="text-xs text-muted-foreground">
                Context: {{ request.summary }}
              </p>
            </div>
          </div>
        </div>

        <div class="space-y-2">
          <label class="text-xs font-medium text-muted-foreground">Branch name</label>
          <Input
            v-model="store.inputValue"
            placeholder="feature/describe-change"
            @keydown.enter.prevent="store.submit"
            autofocus
          />
          <p class="text-xs text-muted-foreground">
            機能や修正内容が分かる短い英語のスラッグにしてください。
          </p>
        </div>

        <div class="flex items-center justify-between gap-3">
          <div class="flex items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              :disabled="store.isGenerating"
              @click="store.generateSuggestion"
            >
              <Loader2 v-if="store.isGenerating" class="mr-2 h-4 w-4 animate-spin" />
              <Wand2 v-else class="mr-2 h-4 w-4" />
              <span>{{ generationLabel }}</span>
            </Button>
            <Badge variant="outline">{{ statusLabel }}</Badge>
          </div>
          <p class="text-xs text-muted-foreground">
            生成が終わると候補が入力欄に入ります。
          </p>
        </div>

        <p class="text-xs text-muted-foreground">
          ブランチ名は作業内容に紐づけてください (例: feature/os-notification-for-branch-prompt)。
        </p>

        <p v-if="store.errorMessage" class="text-sm text-destructive">
          {{ store.errorMessage }}
        </p>
      </div>

      <DialogFooter>
        <Button variant="secondary" @click="store.close">
          Later
        </Button>
        <Button
          :disabled="!store.canSubmit"
          @click="store.submit"
        >
          <Loader2 v-if="store.isSubmitting" class="mr-2 h-4 w-4 animate-spin" />
          <span v-if="store.isSubmitting">Starting...</span>
          <span v-else>完了して作業を開始</span>
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
