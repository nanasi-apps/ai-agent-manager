import { defineStore } from "pinia";
import { computed, ref } from "vue";
import { orpc } from "@/services/orpc";
import type { ApiSettings as SharedApiSettings, ModelProvider } from "@agent-manager/shared";

export type { ModelProvider };

export type ApprovalChannel = "inbox" | "slack" | "discord";

export type ApiSettings = SharedApiSettings;

export interface AppSettings {
    language?: string;
    notifyOnAgentComplete?: boolean;
    approvalNotificationChannels?: ApprovalChannel[];
    newConversionOpenMode?: "page" | "dialog";
    webServerAutoStart?: boolean;
    webServerAutoOpenBrowser?: boolean;
    webServerHost?: string;
    webServerPort?: number;
    slackWebhookUrl?: string;
    discordWebhookUrl?: string;
}

const DEFAULT_NOTIFY_ON_AGENT_COMPLETE = true;

export const useSettingsStore = defineStore("settings", () => {
    // State
    const apiSettings = ref<ApiSettings>({ providers: [] });
    const appSettings = ref<AppSettings>({});
    const isLoading = ref(false);
    const isSaving = ref(false);
    const saveSuccess = ref(false);
    const isLoaded = ref(false);

    // Computed
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

    const providers = computed(() => apiSettings.value.providers || []);

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

            // Update local state - assuming full replacement of updated fields for now or merge
            // Since providers is an array, usually we replace it.
            if (updates.providers) {
                apiSettings.value.providers = updates.providers;
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
            if (updates.webServerAutoStart !== undefined) {
                appSettings.value.webServerAutoStart = updates.webServerAutoStart;
            }
            if (updates.webServerAutoOpenBrowser !== undefined) {
                appSettings.value.webServerAutoOpenBrowser = updates.webServerAutoOpenBrowser;
            }
            if (updates.webServerHost !== undefined) {
                appSettings.value.webServerHost = updates.webServerHost;
            }
            if (updates.webServerPort !== undefined) {
                appSettings.value.webServerPort = updates.webServerPort;
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

    function $reset() {
        apiSettings.value = { providers: [] };
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
        language,
        notifyOnAgentComplete,
        approvalNotificationChannels,
        newConversionOpenMode,
        providers,

        // Helpers
        normalizeChannels,
        areChannelsEqual,
        isApprovalChannelEnabled,

        // Actions
        loadSettings,
        updateApiSettings,
        updateAppSettings,
        $reset,
    };
});
