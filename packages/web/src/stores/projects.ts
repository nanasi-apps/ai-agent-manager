import { defineStore } from "pinia";
import { computed, ref } from "vue";
import { orpcQuery } from "@/services/orpc";

export interface Project {
    id: string;
    name: string;
    description?: string;
    createdAt: number;
    updatedAt: number;
}

export interface Conversation {
    id: string;
    projectId: string;
    title: string;
    createdAt: number;
    updatedAt: number;
    isProcessing?: boolean;
}

export interface ProjectWithConversations extends Project {
    conversations: Conversation[];
}

export const useProjectsStore = defineStore("projects", () => {
    // State
    const projects = ref<Project[]>([]);
    const conversations = ref<Conversation[]>([]);
    const isLoading = ref(false);
    const isLoaded = ref(false);
    const lastLoadedAt = ref<number | null>(null);

    // Computed
    const projectsWithConversations = computed<ProjectWithConversations[]>(() =>
        projects.value.map((p) => ({
            ...p,
            conversations: conversations.value
                .filter((c) => c.projectId === p.id)
                .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)),
        })),
    );

    const recentConversations = computed(() =>
        [...conversations.value]
            .sort((a, b) => b.updatedAt - a.updatedAt)
            .slice(0, 10),
    );

    const getProjectById = (id: string) =>
        projects.value.find((p) => p.id === id);

    const getProjectName = (projectId: string) =>
        getProjectById(projectId)?.name || projectId;

    const getConversationById = (id: string) =>
        conversations.value.find((c) => c.id === id);

    const getConversationsByProjectId = (projectId: string) =>
        conversations.value
            .filter((c) => c.projectId === projectId)
            .sort((a, b) => b.updatedAt - a.updatedAt);

    // Actions
    async function loadAll(force = false) {
        // Skip if recently loaded (within 1 second) unless forced
        if (!force && lastLoadedAt.value && Date.now() - lastLoadedAt.value < 1000) {
            return;
        }

        isLoading.value = true;
        try {
            const [projectsData, conversationsData] = await Promise.all([
                orpcQuery.listProjects.call({}),
                orpcQuery.listConversations.call({}),
            ]);
            projects.value = projectsData;
            conversations.value = conversationsData;
            isLoaded.value = true;
            lastLoadedAt.value = Date.now();
        } catch (err) {
            console.error("Failed to load projects and conversations:", err);
        } finally {
            isLoading.value = false;
        }
    }

    async function loadProjects() {
        try {
            projects.value = await orpcQuery.listProjects.call({});
        } catch (err) {
            console.error("Failed to load projects:", err);
        }
    }

    async function loadConversations() {
        try {
            conversations.value = await orpcQuery.listConversations.call({});
        } catch (err) {
            console.error("Failed to load conversations:", err);
        }
    }

    async function createProject(name: string, rootPath: string, description?: string) {
        try {
            const result = await orpcQuery.createProject.call({ name, rootPath, description });
            if (result.id) {
                await loadProjects();
                return result;
            }
        } catch (err) {
            console.error("Failed to create project:", err);
            throw err;
        }
    }

    async function updateConversationStatus(id: string, isProcessing: boolean) {
        const conv = conversations.value.find((c) => c.id === id);
        if (conv) {
            conv.isProcessing = isProcessing;
        }
    }

    function $reset() {
        projects.value = [];
        conversations.value = [];
        isLoading.value = false;
        isLoaded.value = false;
        lastLoadedAt.value = null;
    }

    return {
        // State
        projects,
        conversations,
        isLoading,
        isLoaded,
        lastLoadedAt,

        // Computed
        projectsWithConversations,
        recentConversations,

        // Getters
        getProjectById,
        getProjectName,
        getConversationById,
        getConversationsByProjectId,

        // Actions
        loadAll,
        loadProjects,
        loadConversations,
        createProject,
        updateConversationStatus,
        $reset,
    };
});
