<script setup lang="ts">
import { FileText, GitBranch, Plug, Play, Square, ExternalLink, Terminal } from "lucide-vue-next";
import { Button } from "@/components/ui/button";
import { useConversationStore } from "@/stores/conversation";
import { watch, onUnmounted, ref } from "vue";
import DevServerLogsViewer from "./DevServerLogsViewer.vue";

const conversation = useConversationStore();
const isLogsOpen = ref(false);

const handleSaveTitle = async () => {
	await conversation.saveTitle();
};

let pollInterval: NodeJS.Timeout | null = null;
watch(
	() => conversation.projectId,
	(pid) => {
		if (pollInterval) {
			clearInterval(pollInterval);
			pollInterval = null;
		}

		if (pid && conversation.sessionId) {
			conversation.loadDevServerStatus(pid, conversation.sessionId);
			// Poll status every 5 seconds to keep sync with external changes (e.g. MCP tools)
			pollInterval = setInterval(() => {
				if (conversation.projectId === pid) {
					conversation.loadDevServerStatus(pid, conversation.sessionId);
				}
			}, 5000);
		}
	},
	{ immediate: true },
);

onUnmounted(() => {
	if (pollInterval) clearInterval(pollInterval);
});
</script>

<template>
	<div
		class="border-b px-6 py-3 flex items-center justify-between bg-card/80 backdrop-blur-xl sticky top-0 z-10 shrink-0"
	>
		<div class="flex items-center gap-3">
			<div>
				<input
					v-model="conversation.titleDraft"
					class="text-base font-semibold bg-transparent border border-transparent hover:border-input focus:border-input rounded-md px-2 -ml-2 py-1 focus:outline-none focus:ring-1 focus:ring-ring focus:bg-accent/50 transition-all max-w-[320px] truncate"
					placeholder="Session name"
					:disabled="conversation.isSavingTitle"
					@blur="handleSaveTitle"
					@keydown.enter.prevent="handleSaveTitle"
				/>
				<div class="flex items-center gap-2">
					<div v-if="conversation.devServer.error" class="flex items-center gap-1.5">
						<span class="text-xs text-destructive" :title="conversation.devServer.error">
							Server Error
						</span>
					</div>

					<div
						v-if="conversation.currentBranch"
						class="flex items-center gap-1 px-2 py-0.5 rounded-full bg-accent/50 text-[10px] text-muted-foreground border"
					>
						<GitBranch class="size-3" />
						<span class="font-mono max-w-[150px] truncate">{{ conversation.currentBranch }}</span>
					</div>
				</div>
			</div>
		</div>

		<div class="flex items-center gap-2">
			<!-- Dev Server Controls -->
			<div v-if="conversation.projectId" class="flex items-center gap-2 border-r pr-2 mr-2">
				<template v-if="conversation.devServer.isRunning || conversation.devServer.status === 'error'">
                    <template v-if="conversation.devServer.status === 'error'">
                         <span class="text-xs text-destructive mr-2 flex items-center gap-1 font-medium">
                            <span class="size-2 rounded-full bg-destructive animate-pulse"></span>
                            Error (Exit: {{ conversation.devServer.exitCode ?? '?' }})
                        </span>
                    </template>
					<template v-else>
                        <a
                            v-if="conversation.devServer.url"
                            :href="conversation.devServer.url"
                            target="_blank"
                            class="text-xs text-blue-500 hover:underline flex items-center gap-1 mr-2 px-2 py-1 rounded hover:bg-accent/50"
                        >
                            {{ conversation.devServer.url }}
                            <ExternalLink class="size-3" />
                        </a>
                        <span v-else class="text-xs text-muted-foreground mr-2">Running (PID: {{ conversation.devServer.pid }})</span>
                    </template>

					<Button
						variant="ghost"
						size="icon"
						class="h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10"
						@click="conversation.stopDevServer()"
						title="Stop Project"
					>
						<Square class="size-4 fill-current" />
					</Button>
                    <Button
                        variant="ghost"
                        size="icon"
                        class="h-8 w-8 text-muted-foreground hover:text-foreground hover:bg-accent/50"
                        @click="isLogsOpen = true"
                        title="View Logs"
                    >
                        <Terminal class="size-4" />
                    </Button>
				</template>

				<Button
					v-else
					variant="ghost"
					size="sm"
					class="h-8 gap-2 text-primary hover:bg-primary/10"
						@click="conversation.launchDevServer()"
					title="Run Project"
				>
					<Play class="size-4 fill-current" />
					<span class="text-xs font-medium">Run</span>
				</Button>
			</div>

			<Button
				v-if="conversation.latestPlanContent"
				variant="ghost"
				size="icon"
				class="h-8 w-8 text-muted-foreground"
				:class="{ 'bg-accent text-accent-foreground': conversation.isPlanViewerOpen }"
				@click="conversation.togglePlanViewer"
				title="View Plan"
			>
				<FileText class="size-4" />
			</Button>
			<Button
				variant="ghost"
				size="icon"
				class="h-8 w-8 text-muted-foreground"
				:class="{ 'bg-accent text-accent-foreground': conversation.isMcpSheetOpen }"
				@click="conversation.toggleMcpSheet"
				title="View MCP Servers"
			>
				<Plug class="size-4" />
			</Button>
		</div>

        <!-- Dialogs -->
        <DevServerLogsViewer
            v-if="conversation.projectId && conversation.sessionId"
            :open="isLogsOpen"
            @update:open="isLogsOpen = $event"
            :project-id="conversation.projectId"
            :conversation-id="conversation.sessionId"
        />
	</div>
</template>
