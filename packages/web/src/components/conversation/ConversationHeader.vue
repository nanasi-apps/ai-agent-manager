<script setup lang="ts">
import { FileText, GitBranch, Plug } from "lucide-vue-next";
import { Button } from "@/components/ui/button";

const props = defineProps<{
	titleDraft: string;
	isSavingTitle: boolean;
	isConnected: boolean;
	currentBranch: string | null;
	isMcpSheetOpen: boolean;
	isPlanViewerOpen: boolean;
}>();

const emit = defineEmits<{
	(e: "update:titleDraft", value: string): void;
	(e: "saveTitle"): void;
	(e: "toggleMcp"): void;
	(e: "togglePlanViewer"): void;
}>();
</script>

<template>
	<div
		class="border-b px-6 py-3 flex items-center justify-between bg-card/80 backdrop-blur-xl sticky top-0 z-10 shrink-0"
	>
		<div class="flex items-center gap-3">
			<div>
				<input
					:value="titleDraft"
					@input="emit('update:titleDraft', ($event.target as HTMLInputElement).value)"
					class="text-base font-semibold bg-transparent border border-transparent hover:border-input focus:border-input rounded-md px-2 -ml-2 py-1 focus:outline-none focus:ring-1 focus:ring-ring focus:bg-accent/50 transition-all max-w-[320px] truncate"
					placeholder="Session name"
					:disabled="isSavingTitle"
					@blur="emit('saveTitle')"
					@keydown.enter.prevent="emit('saveTitle')"
				/>
				<div class="flex items-center gap-2">
					<div class="flex items-center gap-1.5">
						<span
							class="size-1.5 rounded-full"
							:class="isConnected ? 'bg-green-500' : 'bg-red-500'"
						/>
						<span class="text-xs text-muted-foreground">{{
							isConnected ? "Connected" : "Disconnected"
						}}</span>
					</div>

					<div
						v-if="currentBranch"
						class="flex items-center gap-1 px-2 py-0.5 rounded-full bg-accent/50 text-[10px] text-muted-foreground border"
					>
						<GitBranch class="size-3" />
						<span class="font-mono max-w-[150px] truncate">{{ currentBranch }}</span>
					</div>
				</div>
			</div>
		</div>

		<div class="flex items-center gap-2">
			<Button
				variant="ghost"
				size="icon"
				class="h-8 w-8 text-muted-foreground"
				:class="{ 'bg-accent text-accent-foreground': isPlanViewerOpen }"
				@click="emit('togglePlanViewer')"
				title="View Plan"
			>
				<FileText class="size-4" />
			</Button>
			<Button
				variant="ghost"
				size="icon"
				class="h-8 w-8 text-muted-foreground"
				:class="{ 'bg-accent text-accent-foreground': isMcpSheetOpen }"
				@click="emit('toggleMcp')"
				title="View MCP Servers"
			>
				<Plug class="size-4" />
			</Button>
		</div>
	</div>
</template>
