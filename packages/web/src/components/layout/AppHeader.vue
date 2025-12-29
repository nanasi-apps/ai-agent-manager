<template>
  <header class="h-10 border-b flex items-center justify-between px-4 shrink-0 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
    <div class="flex items-center gap-2">
      <h1 class="text-sm font-semibold">{{ title }}</h1>
      <div v-if="currentBranch" class="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-accent/50 border text-[10px] font-medium text-muted-foreground">
        <GitBranch class="size-3" />
        {{ currentBranch }}
      </div>
    </div>

    <div class="flex items-center gap-3">
      <Button variant="outline" size="sm" @click="open" class="h-7 text-[10px] px-2 gap-1">
        <Plus class="size-3" />
        New Project
      </Button>
      <!-- Platform Badge (Hidden by default, visual indicator logic processed in JS) -->
      <span class="hidden px-2 py-0.5 rounded text-[10px] font-bold uppercase"
            :class="platform === 'electron' ? 'bg-blue-600/10 text-blue-600 border border-blue-600/20' : 'bg-green-500/10 text-green-500 border border-green-500/20'">
            {{ platform }} Mode
          </span>
    </div>
  </header>
</template>

<script setup lang="ts">
import { onMounted, ref, watch, onUnmounted } from "vue";
import { useRoute } from "vue-router";
import { Button } from '@/components/ui/button'
import { Plus, GitBranch } from 'lucide-vue-next'
import { useNewProjectDialog } from '@/composables/useNewProjectDialog'
import { orpc } from '@/services/orpc'

const { isOpen } = useNewProjectDialog()
const open = () => isOpen.value = true;
const route = useRoute()

defineProps<{
	title: string;
}>();

const platform = ref<string>("loading...");
const currentBranch = ref<string | null>(null);

const fetchBranch = async () => {
    // We need a projectId to fetch branch. 
    // Try to get it from route. If not available, we might need a generic "current project" or similar.
    // For now, let's try to extract it from route params.
    const projectId = (route.params as any).id as string;
    
    // If we're in a conversion page, we might need to fetch the conversion first to get projectId.
    // This is a bit complex for a header. 
    // Alternatively, if orpc allows fetching branch without projectId (e.g. from root repo), that's easier.
    // Let's check if we have any active project id in route.
    
    let targetProjectId = projectId;
    
    if (route.path.startsWith('/conversions/')) {
        try {
            const conv = await orpc.getConversation({ sessionId: targetProjectId });
            if (conv) {
                targetProjectId = conv.projectId;
            }
        } catch (e) {
            console.error('Failed to get conversation for header branch info', e);
        }
    }

    if (!targetProjectId) {
        // Fallback: list projects and take the first one if we're in a project context
        // This is not perfect but better than nothing.
        // REMOVED: Implicit fallback causes branch to show on Dashboard (root) which is annoying.
        // try {
        //     const projects = await orpc.listProjects();
        //     if (projects.length > 0 && projects[0]) {
        //         targetProjectId = projects[0].id;
        //     }
        // } catch (e) {
        //     // ignore
        // }
    }

    if (targetProjectId) {
        try {
            const branch = await orpc.getCurrentBranch({ projectId: targetProjectId });
            currentBranch.value = branch;
        } catch (e) {
            console.error('Failed to fetch branch in header', e);
            currentBranch.value = null;
        }
    } else {
        currentBranch.value = null;
    }
};

let branchInterval: any = null;

onMounted(() => {
    if (window.electronAPI) {
        platform.value = 'electron';
    } else {
        platform.value = 'web';
    }
    fetchBranch();
    branchInterval = setInterval(fetchBranch, 10000); // Update every 10s
});

onUnmounted(() => {
    if (branchInterval) clearInterval(branchInterval);
});

watch(() => route.path, () => {
    fetchBranch();
});
</script>
