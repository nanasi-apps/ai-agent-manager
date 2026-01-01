<script setup lang="ts">
import { Check, Eye, EyeOff, Key, Loader2, Globe } from "lucide-vue-next";
import { computed, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { watchDebounced } from "@vueuse/core";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { orpc } from "@/services/orpc";

const { t, locale } = useI18n();

interface ApiSettings {
	openaiApiKey?: string;
	openaiBaseUrl?: string;
	geminiApiKey?: string;
	geminiBaseUrl?: string;
}

type ApprovalChannel = "inbox" | "slack" | "discord";

interface AppSettings {
	language?: string;
	notifyOnAgentComplete?: boolean;
	approvalNotificationChannels?: ApprovalChannel[];
}

const defaultNotifyOnAgentComplete = true;

// API Settings state
const apiSettings = ref<ApiSettings>({});
const appSettings = ref<AppSettings>({});
const apiLoading = ref(false);
const apiSaving = ref(false);
const apiSaveSuccess = ref(false);

// Form values for editing
const openaiApiKeyInput = ref("");
const openaiBaseUrlInput = ref("");
const geminiApiKeyInput = ref("");
const geminiBaseUrlInput = ref("");
const selectedLanguage = ref("en");
const notifyOnAgentComplete = ref(defaultNotifyOnAgentComplete);
const approvalNotificationChannels = ref<ApprovalChannel[]>([]);

// Visibility toggles
const showOpenaiKey = ref(false);
const showGeminiKey = ref(false);

// Check if keys are configured
const hasOpenaiKey = computed(() => apiSettings.value.openaiApiKey === "***");
const hasGeminiKey = computed(() => apiSettings.value.geminiApiKey === "***");

const normalizeChannels = (channels: ApprovalChannel[] | undefined) =>
	Array.from(new Set(channels ?? [])).sort();

const areChannelsEqual = (
	a: ApprovalChannel[],
	b: ApprovalChannel[],
): boolean => a.length === b.length && a.every((value, index) => value === b[index]);

const isApprovalChannelEnabled = (channel: ApprovalChannel) =>
	approvalNotificationChannels.value.includes(channel);

const toggleApprovalChannel = (channel: ApprovalChannel, enabled: boolean) => {
	const next = new Set(approvalNotificationChannels.value);
	if (enabled) {
		next.add(channel);
	} else {
		next.delete(channel);
	}
	approvalNotificationChannels.value = Array.from(next);
};

async function loadSettings() {
	apiLoading.value = true;
	try {
		const [apiData, appData] = await Promise.all([
			orpc.getApiSettings(),
			orpc.getAppSettings(),
		]);
		apiSettings.value = apiData;
		appSettings.value = appData;
		// Initialize inputs with base URLs (keys are masked)
		openaiBaseUrlInput.value = apiData.openaiBaseUrl || "";
		geminiBaseUrlInput.value = apiData.geminiBaseUrl || "";
		
		// Initialize language
		if (appData.language) {
			selectedLanguage.value = appData.language;
			locale.value = appData.language;
		} else {
			selectedLanguage.value = locale.value;
		}

		notifyOnAgentComplete.value =
			appData.notifyOnAgentComplete ?? defaultNotifyOnAgentComplete;
		approvalNotificationChannels.value =
			appData.approvalNotificationChannels ?? [];
	} catch (err) {
		console.error("Failed to load settings", err);
	} finally {
		apiLoading.value = false;
	}
}

async function saveSettings(isAutoSave = false) {
	apiSaving.value = true;
	apiSaveSuccess.value = false;
	try {
		const apiUpdates: Partial<ApiSettings> = {};
		const appUpdates: Partial<AppSettings> = {};

		// Only include fields that have been explicitly set
		if (openaiApiKeyInput.value) {
			apiUpdates.openaiApiKey = openaiApiKeyInput.value;
		}
		if (openaiBaseUrlInput.value !== (apiSettings.value.openaiBaseUrl || "")) {
			apiUpdates.openaiBaseUrl = openaiBaseUrlInput.value || undefined;
		}
		if (geminiApiKeyInput.value) {
			apiUpdates.geminiApiKey = geminiApiKeyInput.value;
		}
		if (geminiBaseUrlInput.value !== (apiSettings.value.geminiBaseUrl || "")) {
			apiUpdates.geminiBaseUrl = geminiBaseUrlInput.value || undefined;
		}
		
		// Update language if changed
		if (selectedLanguage.value !== appSettings.value.language) {
			appUpdates.language = selectedLanguage.value;
		}
		const currentNotifySetting =
			appSettings.value.notifyOnAgentComplete ?? defaultNotifyOnAgentComplete;
		if (notifyOnAgentComplete.value !== currentNotifySetting) {
			appUpdates.notifyOnAgentComplete = notifyOnAgentComplete.value;
		}
		const currentApprovalChannels = normalizeChannels(
			appSettings.value.approvalNotificationChannels,
		);
		const nextApprovalChannels = normalizeChannels(
			approvalNotificationChannels.value,
		);
		if (!areChannelsEqual(currentApprovalChannels, nextApprovalChannels)) {
			appUpdates.approvalNotificationChannels = nextApprovalChannels;
		}

		if (
			Object.keys(apiUpdates).length > 0 ||
			Object.keys(appUpdates).length > 0
		) {
			if (Object.keys(apiUpdates).length > 0) {
				await orpc.updateApiSettings(apiUpdates);
			}
			if (Object.keys(appUpdates).length > 0) {
				await orpc.updateAppSettings(appUpdates);
			}

			// Update locale immediately
			if (appUpdates.language) {
				locale.value = appUpdates.language;
			}

			if (isAutoSave) {
				// Update local state to reflect changes without reloading/clearing inputs
				if (apiUpdates.openaiApiKey) apiSettings.value.openaiApiKey = "***";
				if (apiUpdates.geminiApiKey) apiSettings.value.geminiApiKey = "***";
				if (apiUpdates.openaiBaseUrl !== undefined) {
					apiSettings.value.openaiBaseUrl = apiUpdates.openaiBaseUrl;
				}
				if (apiUpdates.geminiBaseUrl !== undefined) {
					apiSettings.value.geminiBaseUrl = apiUpdates.geminiBaseUrl;
				}
				if (appUpdates.language) {
					appSettings.value.language = appUpdates.language;
				}
				if (appUpdates.notifyOnAgentComplete !== undefined) {
					appSettings.value.notifyOnAgentComplete =
						appUpdates.notifyOnAgentComplete;
				}
				if (appUpdates.approvalNotificationChannels !== undefined) {
					appSettings.value.approvalNotificationChannels =
						appUpdates.approvalNotificationChannels;
				}
			} else {
				// Clear key inputs after manual save
				openaiApiKeyInput.value = "";
				geminiApiKeyInput.value = "";
				// Reload to get updated state
				await loadSettings();
			}
			
			apiSaveSuccess.value = true;
			setTimeout(() => {
				apiSaveSuccess.value = false;
			}, 2000);
		}
	} catch (err) {
		console.error("Failed to save settings", err);
	} finally {
		apiSaving.value = false;
	}
}

// Auto-save watcher
watchDebounced(
	[
		openaiApiKeyInput,
		openaiBaseUrlInput,
		geminiApiKeyInput,
		geminiBaseUrlInput,
		selectedLanguage,
		notifyOnAgentComplete,
		approvalNotificationChannels,
	],
	() => {
		saveSettings(true);
	},
	{ debounce: 1000, maxWait: 5000 },
);

async function clearOpenaiKey() {
	apiSaving.value = true;
	try {
		await orpc.updateApiSettings({ openaiApiKey: "" });
		await loadSettings();
	} finally {
		apiSaving.value = false;
	}
}

async function clearGeminiKey() {
	apiSaving.value = true;
	try {
		await orpc.updateApiSettings({ geminiApiKey: "" });
		await loadSettings();
	} finally {
		apiSaving.value = false;
	}
}

onMounted(() => {
	loadSettings();
});
</script>

<template>
  <div class="p-4 space-y-8">
    <div>
      <h1 class="text-2xl font-bold mb-2">{{ t('settings.title') }}</h1>
      <p class="text-muted-foreground">{{ t('settings.description') }}</p>
    </div>
    
    <!-- General Settings Section -->
    <div class="space-y-4">
      <div class="flex items-center gap-2">
        <Globe class="size-5" />
        <h2 class="text-xl font-semibold">{{ t('settings.generalSettings') }}</h2>
      </div>
      <p class="text-sm text-muted-foreground">
        {{ t('settings.generalSettingsDesc') }}
      </p>

      <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle class="text-base">{{ t('settings.language') }}</CardTitle>
            <CardDescription>
              {{ t('settings.languageDesc') }}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div class="space-y-2">
              <Label>{{ t('settings.language') }}</Label>
              <select
                v-model="selectedLanguage"
                class="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <option value="en">English</option>
                <option value="ja">日本語</option>
              </select>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle class="text-base">{{ t('settings.notifications.title') }}</CardTitle>
            <CardDescription>
              {{ t('settings.notifications.desc') }}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div class="space-y-4">
              <div class="flex items-center gap-3">
                <Checkbox
                  id="notify-on-agent-complete"
                  :checked="notifyOnAgentComplete"
                  @update:checked="(checked: boolean | 'indeterminate') => {
                    notifyOnAgentComplete = checked === true;
                  }"
                />
                <Label
                  for="notify-on-agent-complete"
                  class="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer select-none"
                >
                  {{ t('settings.notifications.onCompletion') }}
                </Label>
              </div>
              <div class="space-y-2">
                <Label class="text-sm font-medium">
                  {{ t('settings.notifications.approvalsTitle') }}
                </Label>
                <p class="text-xs text-muted-foreground">
                  {{ t('settings.notifications.approvalsDesc') }}
                </p>
                <div class="flex items-center gap-3">
                  <Checkbox
                    id="notify-approval-slack"
                    :checked="isApprovalChannelEnabled('slack')"
                    @update:checked="(checked: boolean | 'indeterminate') => {
                      toggleApprovalChannel('slack', checked === true);
                    }"
                  />
                  <Label
                    for="notify-approval-slack"
                    class="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer select-none"
                  >
                    {{ t('settings.notifications.channels.slack') }}
                  </Label>
                </div>
                <div class="flex items-center gap-3">
                  <Checkbox
                    id="notify-approval-discord"
                    :checked="isApprovalChannelEnabled('discord')"
                    @update:checked="(checked: boolean | 'indeterminate') => {
                      toggleApprovalChannel('discord', checked === true);
                    }"
                  />
                  <Label
                    for="notify-approval-discord"
                    class="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer select-none"
                  >
                    {{ t('settings.notifications.channels.discord') }}
                  </Label>
                </div>
                <p class="text-xs text-muted-foreground">
                  {{ t('settings.notifications.approvalsHint') }}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>

    <!-- API Settings Section -->
    <div class="space-y-4">
      <div class="flex items-center gap-2">
        <Key class="size-5" />
        <h2 class="text-xl font-semibold">{{ t('settings.apiSettings') }}</h2>
      </div>

      <p class="text-sm text-muted-foreground">
        {{ t('settings.apiSettingsDesc') }}
      </p>

      <div v-if="apiLoading" class="flex items-center gap-2 text-muted-foreground">
        <Loader2 class="size-4 animate-spin" />
        {{ t('settings.loading') }}
      </div>

      <div v-else class="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <!-- OpenAI Settings -->
        <Card>
          <CardHeader>
            <div class="flex items-center justify-between">
              <CardTitle class="text-base">{{ t('settings.openai.title') }}</CardTitle>
              <Badge v-if="hasOpenaiKey" variant="secondary" class="text-green-600">
                <Check class="size-3 mr-1" />
                {{ t('settings.openai.configured') }}
              </Badge>
              <Badge v-else variant="outline">{{ t('settings.openai.notSet') }}</Badge>
            </div>
            <CardDescription>
              {{ t('settings.openai.desc') }}
            </CardDescription>
          </CardHeader>
          <CardContent class="space-y-4">
            <div class="space-y-2">
              <Label>{{ t('settings.openai.apiKey') }}</Label>
              <div class="flex gap-2">
                <div class="relative flex-1">
                  <Input
                    v-model="openaiApiKeyInput"
                    :type="showOpenaiKey ? 'text' : 'password'"
                    :placeholder="hasOpenaiKey ? '••••••••••••••••' : 'sk-...'"
                  />
                  <button
                    type="button"
                    class="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    @click="showOpenaiKey = !showOpenaiKey"
                  >
                    <EyeOff v-if="showOpenaiKey" class="size-4" />
                    <Eye v-else class="size-4" />
                  </button>
                </div>
                <Button
                  v-if="hasOpenaiKey"
                  variant="destructive"
                  size="sm"
                  @click="clearOpenaiKey"
                  :disabled="apiSaving"
                >
                  {{ t('general.clear') }}
                </Button>
              </div>
            </div>
            <div class="space-y-2">
              <Label>{{ t('settings.openai.baseUrl') }}</Label>
              <Input
                v-model="openaiBaseUrlInput"
                type="url"
                placeholder="https://api.openai.com/v1"
              />
              <p class="text-xs text-muted-foreground">
                {{ t('settings.openai.baseUrlDesc') }}
              </p>
            </div>
          </CardContent>
        </Card>

        <!-- Gemini Settings -->
        <Card>
          <CardHeader>
            <div class="flex items-center justify-between">
              <CardTitle class="text-base">{{ t('settings.gemini.title') }}</CardTitle>
              <Badge v-if="hasGeminiKey" variant="secondary" class="text-green-600">
                <Check class="size-3 mr-1" />
                {{ t('settings.gemini.configured') }}
              </Badge>
              <Badge v-else variant="outline">{{ t('settings.gemini.notSet') }}</Badge>
            </div>
            <CardDescription>
              {{ t('settings.gemini.desc') }}
            </CardDescription>
          </CardHeader>
          <CardContent class="space-y-4">
            <div class="space-y-2">
              <Label>{{ t('settings.gemini.apiKey') }}</Label>
              <div class="flex gap-2">
                <div class="relative flex-1">
                  <Input
                    v-model="geminiApiKeyInput"
                    :type="showGeminiKey ? 'text' : 'password'"
                    :placeholder="hasGeminiKey ? '••••••••••••••••' : 'AIza...'"
                  />
                  <button
                    type="button"
                    class="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    @click="showGeminiKey = !showGeminiKey"
                  >
                    <EyeOff v-if="showGeminiKey" class="size-4" />
                    <Eye v-else class="size-4" />
                  </button>
                </div>
                <Button
                  v-if="hasGeminiKey"
                  variant="destructive"
                  size="sm"
                  @click="clearGeminiKey"
                  :disabled="apiSaving"
                >
                  {{ t('general.clear') }}
                </Button>
              </div>
            </div>
            <div class="space-y-2">
              <Label>{{ t('settings.gemini.baseUrl') }}</Label>
              <Input
                v-model="geminiBaseUrlInput"
                type="url"
                placeholder="https://generativelanguage.googleapis.com"
              />
              <p class="text-xs text-muted-foreground">
                 {{ t('settings.gemini.baseUrlDesc') }}
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      <div class="flex items-center gap-4">
        <Button @click="saveSettings" :disabled="apiSaving || apiLoading">
          <Loader2 v-if="apiSaving" class="size-4 mr-2 animate-spin" />
          <Check v-else-if="apiSaveSuccess" class="size-4 mr-2" />
          {{ apiSaveSuccess ? t('general.saved') : t('settings.saveButton') }}
        </Button>
      </div>
    </div>
  </div>
</template>
