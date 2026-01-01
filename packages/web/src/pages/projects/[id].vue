<script setup lang="ts">
import {
	GitBranch,
	Loader2,
	MessageSquare,
	Plus,
	Settings,
} from "lucide-vue-next";
import { computed, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import ConversionCard from "@/components/ConversionCard.vue";
import { Button } from "@/components/ui/button";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import { useNewConversionDialog } from "@/composables/useNewConversionDialog";
import { MIN_LOAD_TIME } from "@/lib/constants";
import { getRouteParamFrom } from "@/lib/route-params";
import { orpc } from "@/services/orpc";

const route = useRoute();
const router = useRouter();
const { open } = useNewConversionDialog();

// Safely access route param
const projectId = computed(() => getRouteParamFrom(route.params, "id"));
const isSubRoute = computed(
	() => route.path.endsWith("/settings") || route.path.endsWith("/worktrees"),
);
const project = ref<{ id: string; name: string; rootPath?: string } | null>(
	null,
);
const conversations = ref<any[]>([]);
const isLoading = ref(true);

const loadData = async () => {
	const id = projectId.value;
	if (!id) return;

	isLoading.value = true;
	const minLoadTime = new Promise((resolve) =>
		setTimeout(resolve, MIN_LOAD_TIME),
	);

	try {
		const [p, convs] = await Promise.all([
			orpc.getProject({ projectId: id }),
			orpc.listConversations({ projectId: id }),
		]);
		project.value = p;
		conversations.value = convs.sort((a, b) => b.updatedAt - a.updatedAt);
	} catch (e) {
		console.error(e);
	} finally {
		await minLoadTime;
		isLoading.value = false;
	}
};

const openConversation = (id: string) => {
	router.push(`/conversions/${id}`);
};

const goSettings = (id?: string) => {
	if (!id) return;
	router.push(`/projects/${id}/settings`);
};

const goWorktrees = (id?: string) => {
	if (!id) return;
	router.push(`/projects/${id}/worktrees`);
};

watch(projectId, loadData, { immediate: true });
</script>

<template>
  <div class="p-6">
    <router-view v-if="isSubRoute" />
    <Transition v-else name="fade" mode="out-in">
      <div v-if="isLoading" class="flex items-center justify-center py-20">
        <Loader2 class="size-8 animate-spin text-muted-foreground" />
      </div>

      <div v-else>
        <div class="flex items-center justify-between mb-8">
           <div class="min-w-0 flex-1">
             <h1 class="text-2xl font-bold truncate">Project Viewer</h1>
             <p class="text-muted-foreground truncate">
               Viewing project: <span class="font-medium text-foreground">{{ project?.name || projectId }}</span>
             </p>
           </div>
           <div class="flex items-center gap-2 shrink-0 ml-4">
             <TooltipProvider :delay-duration="0">
                <Tooltip>
                  <TooltipTrigger as-child>
                    <Button variant="secondary" size="icon" @click="goWorktrees(projectId)">
                      <GitBranch class="size-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    Worktrees
                  </TooltipContent>
                </Tooltip>

                <Tooltip>
                  <TooltipTrigger as-child>
                    <Button variant="secondary" size="icon" @click="goSettings(projectId)">
                      <Settings class="size-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    Settings
                  </TooltipContent>
                </Tooltip>

                <Tooltip>
                  <TooltipTrigger as-child>
                    <Button size="icon" @click="open">
                      <Plus class="size-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    New Conversion
                  </TooltipContent>
                </Tooltip>
             </TooltipProvider>
           </div>
        </div>

        <!-- Conversations List -->
        <div class="space-y-4">
          <h2 class="text-xl font-semibold">Conversations</h2>
          
          <div v-if="conversations.length > 0" class="space-y-2">
            <ConversionCard
              v-for="conv in conversations"
              :key="conv.id"
              :title="conv.title"
              :project-name="project?.name"
              :updated-at="conv.updatedAt"
              :is-running="conv.isProcessing"
              @click="openConversation(conv.id)"
            />
          </div>

          <div v-else class="text-center py-12 text-muted-foreground border rounded-lg border-dashed">
            <MessageSquare class="size-12 mx-auto mb-4 opacity-20" />
            <p>No conversations in this project yet.</p>
            <Button variant="link" @click="open" class="mt-2">
              Start your first conversation
            </Button>
          </div>
        </div>
      </div>
    </Transition>
  </div>
</template>
