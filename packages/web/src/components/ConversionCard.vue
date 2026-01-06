<script setup lang="ts">
import { ExternalLink, Loader2, MessageSquare } from "lucide-vue-next";
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { Card, CardContent } from "@/components/ui/card";

const { t } = useI18n();

const props = defineProps<{
	title: string;
	projectName?: string;
	updatedAt: number;
	isRunning?: boolean;
}>();

const formattedTime = computed(() => {
	const date = new Date(props.updatedAt);
	const now = new Date();
	const diff = now.getTime() - date.getTime();

	if (diff < 60000) return t("time.justNow");
	if (diff < 3600000)
		return t("time.ago", { time: `${Math.floor(diff / 60000)}m` });
	if (diff < 86400000)
		return t("time.ago", { time: `${Math.floor(diff / 3600000)}h` });
	return date.toLocaleDateString();
});
</script>

<template>
	<Card
		class="cursor-pointer transition-all hover:shadow-md hover:border-primary/50 group bg-card/50 hover:bg-card"
	>
		<CardContent class="p-4 flex items-center justify-between">
			<div class="flex items-center gap-3 min-w-0">
				<div
					class="size-10 rounded-full bg-muted/50 flex items-center justify-center shrink-0 group-hover:bg-primary/10 transition-colors"
				>
					<MessageSquare
						class="size-5 text-muted-foreground group-hover:text-primary transition-colors"
					/>
				</div>
				<div class="min-w-0 flex flex-col gap-0.5">
					<div class="flex items-center gap-2">
						<p
							class="font-medium text-sm truncate group-hover:text-primary transition-colors"
						>
							{{ title }}
						</p>
						<Loader2
							v-if="isRunning"
							class="size-3 animate-spin shrink-0 text-muted-foreground"
						/>
					</div>
					<div class="flex items-center gap-2 text-xs text-muted-foreground">
						<span
							v-if="projectName"
							class="truncate max-w-[150px] font-medium text-foreground/70"
						>
							{{ projectName }}
						</span>
						<span v-if="projectName" class="text-muted-foreground/30">•</span>
						<span class="flex items-center gap-1 truncate">
							{{ formattedTime }}
						</span>
					</div>
				</div>
			</div>
			<div
				class="opacity-0 group-hover:opacity-100 transition-opacity -translate-x-2 group-hover:translate-x-0 duration-200"
			>
				<ExternalLink class="size-4 text-muted-foreground"/>
			</div>
		</CardContent>
	</Card>
</template>
