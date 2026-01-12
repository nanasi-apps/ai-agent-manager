<script setup lang="ts">
import { Loader2, MessageSquare } from "lucide-vue-next";
import { onMounted } from "vue";
import { useI18n } from "vue-i18n";
import { useRouter } from "vue-router";
import ConversionCard from "@/components/ConversionCard.vue";
import { useProjectsStore } from "@/stores/projects";

const { t } = useI18n();
const router = useRouter();
const projectsStore = useProjectsStore();

const openConversation = (id: string) => {
	router.push(`/conversions/${id}`);
};

onMounted(() => {
	// Only load if not already loaded or if data is stale
	if (!projectsStore.isLoaded) {
		projectsStore.loadAll();
	}
});
</script>

<template>
	<div class="p-6 space-y-8">
		<!-- Header -->
		<div class="space-y-2">
			<h1 class="text-3xl font-bold tracking-tight">
				{{ t('dashboard.title') }}
			</h1>
			<p class="text-muted-foreground">{{ t('dashboard.subtitle') }}</p>
		</div>

		<!-- Loading State -->
		<Transition name="fade" mode="out-in">
			<div
				v-if="projectsStore.isLoading && !projectsStore.isLoaded"
				class="flex items-center justify-center py-20"
			>
				<Loader2 class="size-8 animate-spin text-muted-foreground"/>
			</div>

			<div v-else>
				<!-- Recent Conversations -->
				<section
					v-if="projectsStore.recentConversations.length > 0"
					class="space-y-4"
				>
					<h2 class="text-xl font-semibold">
						{{ t('dashboard.recentConversations') }}
					</h2>

					<div class="space-y-2">
						<ConversionCard
							v-for="conv in projectsStore.recentConversations"
							:key="conv.id"
							:id="conv.id"
							:title="conv.title"
							:project-name="projectsStore.getProjectName(conv.projectId)"
							:updated-at="conv.updatedAt"
							:is-running="conv.isProcessing"
							@open="openConversation"
						/>
					</div>
				</section>

				<!-- Empty State for Recent -->
				<section v-else class="text-center py-12 text-muted-foreground">
					<MessageSquare class="size-12 mx-auto mb-4 opacity-20"/>
					<p>{{ t('dashboard.noConversations') }}</p>
				</section>
			</div>
		</Transition>
	</div>
</template>
