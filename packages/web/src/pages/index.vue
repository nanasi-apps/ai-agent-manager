<script setup lang="ts">
import { Loader2, MessageSquare } from "lucide-vue-next";
import { onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { useI18n } from "vue-i18n";
import ConversionCard from "@/components/ConversionCard.vue";
import { MIN_LOAD_TIME } from "@/lib/constants";
import { orpc } from "@/services/orpc";

const { t } = useI18n();
// Project from API - user-created projects
interface UserProject {
	id: string;
	name: string;
	description?: string;
	createdAt: number;
	updatedAt: number;
}

interface Conversation {
	id: string;
	projectId: string;
	title: string;
	createdAt: number;
	updatedAt: number;
}

const router = useRouter();

const userProjects = ref<UserProject[]>([]);
const recentConversations = ref<Conversation[]>([]);
const isLoading = ref(true);

const loadData = async () => {
	isLoading.value = true;
	const minLoadTime = new Promise((resolve) =>
		setTimeout(resolve, MIN_LOAD_TIME),
	);
	try {
		const [projectsData, conversationsData] = await Promise.all([
			orpc.listProjects({}),
			orpc.listConversations({}),
		]);
		userProjects.value = projectsData;
		// Get most recent 5 conversations
		recentConversations.value = conversationsData
			.sort((a: Conversation, b: Conversation) => b.updatedAt - a.updatedAt)
			.slice(0, 10); // Show more recent conversions if it's the main focus
	} catch (err) {
		console.error("Failed to load data:", err);
	} finally {
		await minLoadTime;
		isLoading.value = false;
	}
};

const openConversation = (id: string) => {
	router.push(`/conversions/${id}`);
};

const getProjectName = (projectId: string) => {
	return userProjects.value.find((p) => p.id === projectId)?.name || projectId;
};

onMounted(() => {
	loadData();
});
</script>

<template>
  <div class="p-6 space-y-8">
    <!-- Header -->
    <div class="space-y-2">
      <h1 class="text-3xl font-bold tracking-tight">{{ t('dashboard.title') }}</h1>
      <p class="text-muted-foreground">{{ t('dashboard.subtitle') }}</p>
    </div>
    
    <!-- Loading State -->
    <Transition name="fade" mode="out-in">
      <!-- Loading State -->
      <div v-if="isLoading" class="flex items-center justify-center py-20">
        <Loader2 class="size-8 animate-spin text-muted-foreground" />
      </div>

      <div v-else>
        <!-- Recent Conversations -->
        <section v-if="recentConversations.length > 0" class="space-y-4">
          <h2 class="text-xl font-semibold">{{ t('dashboard.recentConversations') }}</h2>
          
          <div class="space-y-2">
            <ConversionCard
              v-for="conv in recentConversations"
              :key="conv.id"
              :title="conv.title"
              :project-name="getProjectName(conv.projectId)"
              :updated-at="conv.updatedAt"
              @click="openConversation(conv.id)"
            />
          </div>
        </section>

        <!-- Empty State for Recent -->
        <section v-else class="text-center py-12 text-muted-foreground">
          <MessageSquare class="size-12 mx-auto mb-4 opacity-20" />
          <p>{{ t('dashboard.noConversations') }}</p>
        </section>
      </div>
    </Transition>
  </div>
</template>
