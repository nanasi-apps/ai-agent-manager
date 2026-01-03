<script setup lang="ts">
import { FileText, GitBranch, Plug } from "lucide-vue-next";
import { Button } from "@/components/ui/button";
import { useConversationStore } from "@/stores/conversation";

const conversation = useConversationStore();

const handleSaveTitle = async () => {
	await conversation.saveTitle();
};
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
					<div class="flex items-center gap-1.5">
						<span
							class="size-1.5 rounded-full"
							:class="conversation.isConnected ? 'bg-green-500' : 'bg-red-500'"
						/>
						<span class="text-xs text-muted-foreground">{{
							conversation.isConnected ? "Connected" : "Disconnected"
						}}</span>
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
	</div>
</template>
