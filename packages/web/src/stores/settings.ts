import { defineStore } from "pinia";
import { computed, ref } from "vue";
import { orpc } from "@/services/orpc";

export type ApprovalChannel = "inbox" | "slack" | "discord";

export interface ApiSettings {
    openaiApiKey?: string;
    openaiBaseUrl?: string;
    geminiApiKey?: string;
    geminiBaseUrl?: string;
}

export interface AppSettings {
    language?: string;
    notifyOnAgentComplete?: boolean;
    approvalNotificationChannels?: ApprovalChannel[];
    newConversionOpenMode?: "page" | "dialog";
    slackWebhookUrl?: string;
    discordWebhookUrl?: string;
}

const DEFAULT_NOTIFY_ON_AGENT_COMPLETE = true;

export const useSettingsStore = defineStore("settings", () => {
    // State
    const apiSettings = ref<ApiSettings>({});
    const appSettings = ref<AppSettings>({});
    const isLoading = ref(false);
    const isSaving = ref(false);
    const saveSuccess = ref(false);
    const isLoaded = ref(false);

    // Computed
    const hasOpenaiKey = computed(() => apiSettings.value.openaiApiKey === "***");
    const hasGeminiKey = computed(() => apiSettings.value.geminiApiKey === "***");
    const language = computed(() => appSettings.value.language ?? "en");
    const notifyOnAgentComplete = computed(
        () => appSettings.value.notifyOnAgentComplete ?? DEFAULT_NOTIFY_ON_AGENT_COMPLETE,
    );
    const approvalNotificationChannels = computed(
        () => appSettings.value.approvalNotificationChannels ?? [],
    );
    const newConversionOpenMode = computed(
        () => appSettings.value.newConversionOpenMode ?? "page",
    );

    // Helpers
    const normalizeChannels = (channels: ApprovalChannel[] | undefined) =>
        Array.from(new Set(channels ?? [])).sort();

    const areChannelsEqual = (
        a: ApprovalChannel[],
        b: ApprovalChannel[],
    ): boolean => a.length === b.length && a.every((value, index) => value === b[index]);

    const isApprovalChannelEnabled = (channel: ApprovalChannel) =>
        approvalNotificationChannels.value.includes(channel);

    // Actions
    async function loadSettings() {
        if (isLoading.value) return;

        isLoading.value = true;
        try {
            const [apiData, appData] = await Promise.all([
                orpc.getApiSettings(),
                orpc.getAppSettings(),
            ]);
            apiSettings.value = apiData;
            appSettings.value = appData;
            isLoaded.value = true;
        } catch (err) {
            console.error("Failed to load settings", err);
        } finally {
            isLoading.value = false;
        }
    }

    async function updateApiSettings(updates: Partial<ApiSettings>) {
        if (Object.keys(updates).length === 0) return;

        isSaving.value = true;
        saveSuccess.value = false;
        try {
            await orpc.updateApiSettings(updates);

            // Update local state
            if (updates.openaiApiKey) apiSettings.value.openaiApiKey = "***";
            if (updates.geminiApiKey) apiSettings.value.geminiApiKey = "***";
            if (updates.openaiBaseUrl !== undefined) {
                apiSettings.value.openaiBaseUrl = updates.openaiBaseUrl;
            }
            if (updates.geminiBaseUrl !== undefined) {
                apiSettings.value.geminiBaseUrl = updates.geminiBaseUrl;
            }

            saveSuccess.value = true;
            setTimeout(() => (saveSuccess.value = false), 2000);
        } catch (err) {
            console.error("Failed to update API settings", err);
            throw err;
        } finally {
            isSaving.value = false;
        }
    }

    async function updateAppSettings(updates: Partial<AppSettings>) {
        if (Object.keys(updates).length === 0) return;

        isSaving.value = true;
        saveSuccess.value = false;
        try {
            await orpc.updateAppSettings(updates);

            // Update local state
            if (updates.language !== undefined) {
                appSettings.value.language = updates.language;
            }
            if (updates.notifyOnAgentComplete !== undefined) {
                appSettings.value.notifyOnAgentComplete = updates.notifyOnAgentComplete;
            }
            if (updates.approvalNotificationChannels !== undefined) {
                appSettings.value.approvalNotificationChannels =
                    updates.approvalNotificationChannels;
            }
            if (updates.newConversionOpenMode !== undefined) {
                appSettings.value.newConversionOpenMode = updates.newConversionOpenMode;
            }
            if (updates.slackWebhookUrl !== undefined) {
                appSettings.value.slackWebhookUrl = updates.slackWebhookUrl;
            }
            if (updates.discordWebhookUrl !== undefined) {
                appSettings.value.discordWebhookUrl = updates.discordWebhookUrl;
            }

            saveSuccess.value = true;
            setTimeout(() => (saveSuccess.value = false), 2000);
        } catch (err) {
            console.error("Failed to update app settings", err);
            throw err;
        } finally {
            isSaving.value = false;
        }
    }

    async function clearApiKey(key: "openai" | "gemini") {
        isSaving.value = true;
        try {
            if (key === "openai") {
                await orpc.updateApiSettings({ openaiApiKey: "" });
                apiSettings.value.openaiApiKey = undefined;
            } else {
                await orpc.updateApiSettings({ geminiApiKey: "" });
                apiSettings.value.geminiApiKey = undefined;
            }
        } finally {
            isSaving.value = false;
        }
    }

    function $reset() {
        apiSettings.value = {};
        appSettings.value = {};
        isLoading.value = false;
        isSaving.value = false;
        saveSuccess.value = false;
        isLoaded.value = false;
    }

    return {
        // State
        apiSettings,
        appSettings,
        isLoading,
        isSaving,
        saveSuccess,
        isLoaded,

        // Computed
        hasOpenaiKey,
        hasGeminiKey,
        language,
        notifyOnAgentComplete,
        approvalNotificationChannels,
        newConversionOpenMode,

        // Helpers
        normalizeChannels,
        areChannelsEqual,
        isApprovalChannelEnabled,

        // Actions
        loadSettings,
        updateApiSettings,
        updateAppSettings,
        clearApiKey,
        $reset,
    };
});
