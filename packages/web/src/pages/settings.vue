<script setup lang="ts">
import { Check, Eye, EyeOff, Key, Loader2, Globe } from "lucide-vue-next";
import { onMounted, ref, watch } from "vue";
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
import { useSettingsStore, type ApprovalChannel } from "@/stores/settings";

const { t, locale } = useI18n();
const settingsStore = useSettingsStore();

// Form values for editing (local inputs that get synced to store)
const openaiApiKeyInput = ref("");
const openaiBaseUrlInput = ref("");
const geminiApiKeyInput = ref("");
const geminiBaseUrlInput = ref("");
const selectedLanguage = ref("en");
const notifyOnAgentComplete = ref(true);
const approvalNotificationChannels = ref<ApprovalChannel[]>([]);
const newConversionOpenMode = ref<"page" | "dialog">("page");
const slackWebhookUrl = ref("");
const discordWebhookUrl = ref("");

// Visibility toggles
const showOpenaiKey = ref(false);
const showGeminiKey = ref(false);
const showSlackWebhook = ref(false);
const showDiscordWebhook = ref(false);

// Local helpers
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

// Sync local state from store
function syncFromStore() {
	openaiBaseUrlInput.value = settingsStore.apiSettings.openaiBaseUrl || "";
	geminiBaseUrlInput.value = settingsStore.apiSettings.geminiBaseUrl || "";
	
	selectedLanguage.value = settingsStore.language;
	locale.value = settingsStore.language;
	
	notifyOnAgentComplete.value = settingsStore.notifyOnAgentComplete;
	approvalNotificationChannels.value = [...settingsStore.approvalNotificationChannels];
	newConversionOpenMode.value = settingsStore.newConversionOpenMode;
	slackWebhookUrl.value = settingsStore.appSettings.slackWebhookUrl || "";
	discordWebhookUrl.value = settingsStore.appSettings.discordWebhookUrl || "";
}

async function loadSettings() {
	await settingsStore.loadSettings();
	syncFromStore();
}

async function saveSettings(isAutoSave = false) {
	const apiUpdates: Record<string, string | undefined> = {};
	const appUpdates: Record<string, unknown> = {};

	// Only include fields that have been explicitly set
	if (openaiApiKeyInput.value) {
		apiUpdates.openaiApiKey = openaiApiKeyInput.value;
	}
	if (openaiBaseUrlInput.value !== (settingsStore.apiSettings.openaiBaseUrl || "")) {
		apiUpdates.openaiBaseUrl = openaiBaseUrlInput.value || undefined;
	}
	if (geminiApiKeyInput.value) {
		apiUpdates.geminiApiKey = geminiApiKeyInput.value;
	}
	if (geminiBaseUrlInput.value !== (settingsStore.apiSettings.geminiBaseUrl || "")) {
		apiUpdates.geminiBaseUrl = geminiBaseUrlInput.value || undefined;
	}
	
	// Update language if changed
	if (selectedLanguage.value !== settingsStore.appSettings.language) {
		appUpdates.language = selectedLanguage.value;
	}
	if (notifyOnAgentComplete.value !== settingsStore.notifyOnAgentComplete) {
		appUpdates.notifyOnAgentComplete = notifyOnAgentComplete.value;
	}
	
	const currentChannels = settingsStore.normalizeChannels(
		settingsStore.appSettings.approvalNotificationChannels,
	);
	const nextChannels = settingsStore.normalizeChannels(
		approvalNotificationChannels.value,
	);
	if (!settingsStore.areChannelsEqual(currentChannels, nextChannels)) {
		appUpdates.approvalNotificationChannels = nextChannels;
	}
	if (newConversionOpenMode.value !== settingsStore.newConversionOpenMode) {
		appUpdates.newConversionOpenMode = newConversionOpenMode.value;
	}
	if (slackWebhookUrl.value !== (settingsStore.appSettings.slackWebhookUrl || "")) {
		appUpdates.slackWebhookUrl = slackWebhookUrl.value || undefined;
	}
	if (discordWebhookUrl.value !== (settingsStore.appSettings.discordWebhookUrl || "")) {
		appUpdates.discordWebhookUrl = discordWebhookUrl.value || undefined;
	}

	try {
		if (Object.keys(apiUpdates).length > 0) {
			await settingsStore.updateApiSettings(apiUpdates);
		}
		if (Object.keys(appUpdates).length > 0) {
			await settingsStore.updateAppSettings(appUpdates);
		}

		// Update locale immediately
		if (appUpdates.language) {
			locale.value = appUpdates.language as string;
		}

		if (!isAutoSave) {
			// Clear key inputs after manual save
			openaiApiKeyInput.value = "";
			geminiApiKeyInput.value = "";
		}
	} catch (err) {
		console.error("Failed to save settings", err);
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
		newConversionOpenMode,
		slackWebhookUrl,
		discordWebhookUrl,
	],
	() => {
		saveSettings(true);
	},
	{ debounce: 1000, maxWait: 5000 },
);

async function clearOpenaiKey() {
	await settingsStore.clearApiKey("openai");
}

async function clearGeminiKey() {
	await settingsStore.clearApiKey("gemini");
}

onMounted(() => {
	if (settingsStore.isLoaded) {
		syncFromStore();
	} else {
		loadSettings();
	}
});

// Watch for external store changes
watch(
	() => settingsStore.isLoaded,
	(isLoaded) => {
		if (isLoaded) {
			syncFromStore();
		}
	},
);
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
                  <div class="flex-1 space-y-2">
                    <Label
                      for="notify-approval-slack"
                      class="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer select-none"
                    >
                      {{ t('settings.notifications.channels.slack') }}
                    </Label>
                    <div v-if="isApprovalChannelEnabled('slack')" class="relative">
                      <Input
                        v-model="slackWebhookUrl"
                        :type="showSlackWebhook ? 'text' : 'password'"
                        placeholder="https://hooks.slack.com/services/..."
                        class="h-8 text-xs"
                      />
                       <button
                        type="button"
                        class="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                        @click="showSlackWebhook = !showSlackWebhook"
                      >
                        <EyeOff v-if="showSlackWebhook" class="size-3" />
                        <Eye v-else class="size-3" />
                      </button>
                    </div>
                  </div>
                </div>
                <div class="flex items-center gap-3">
                  <Checkbox
                    id="notify-approval-discord"
                    :checked="isApprovalChannelEnabled('discord')"
                    @update:checked="(checked: boolean | 'indeterminate') => {
                      toggleApprovalChannel('discord', checked === true);
                    }"
                  />
                  <div class="flex-1 space-y-2">
                    <Label
                      for="notify-approval-discord"
                      class="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer select-none"
                    >
                      {{ t('settings.notifications.channels.discord') }}
                    </Label>
                    <div v-if="isApprovalChannelEnabled('discord')" class="relative">
                      <Input
                        v-model="discordWebhookUrl"
                        :type="showDiscordWebhook ? 'text' : 'password'"
                        placeholder="https://discord.com/api/webhooks/..."
                        class="h-8 text-xs"
                      />
                      <button
                        type="button"
                        class="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                        @click="showDiscordWebhook = !showDiscordWebhook"
                      >
                         <EyeOff v-if="showDiscordWebhook" class="size-3" />
                        <Eye v-else class="size-3" />
                      </button>
                    </div>
                  </div>
                </div>
                <p class="text-xs text-muted-foreground">
                  {{ t('settings.notifications.approvalsHint') }}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle class="text-base">{{ t('settings.newConversion.title') }}</CardTitle>
            <CardDescription>
              {{ t('settings.newConversion.desc') }}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div class="space-y-2">
              <Label>{{ t('settings.newConversion.openMode') }}</Label>
              <select
                v-model="newConversionOpenMode"
                class="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <option value="page">{{ t('settings.newConversion.page') }}</option>
                <option value="dialog">{{ t('settings.newConversion.dialog') }}</option>
              </select>
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

      <div v-if="settingsStore.isLoading" class="flex items-center gap-2 text-muted-foreground">
        <Loader2 class="size-4 animate-spin" />
        {{ t('settings.loading') }}
      </div>

      <div v-else class="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <!-- OpenAI Settings -->
        <Card>
          <CardHeader>
            <div class="flex items-center justify-between">
              <CardTitle class="text-base">{{ t('settings.openai.title') }}</CardTitle>
              <Badge v-if="settingsStore.hasOpenaiKey" variant="secondary" class="text-green-600">
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
                    :placeholder="settingsStore.hasOpenaiKey ? '••••••••••••••••' : 'sk-...'"
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
                  v-if="settingsStore.hasOpenaiKey"
                  variant="destructive"
                  size="sm"
                  @click="clearOpenaiKey"
                  :disabled="settingsStore.isSaving"
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
              <Badge v-if="settingsStore.hasGeminiKey" variant="secondary" class="text-green-600">
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
                    :placeholder="settingsStore.hasGeminiKey ? '••••••••••••••••' : 'AIza...'"
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
                  v-if="settingsStore.hasGeminiKey"
                  variant="destructive"
                  size="sm"
                  @click="clearGeminiKey"
                  :disabled="settingsStore.isSaving"
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
        <Button @click="saveSettings(false)" :disabled="settingsStore.isSaving || settingsStore.isLoading">
          <Loader2 v-if="settingsStore.isSaving" class="size-4 mr-2 animate-spin" />
          <Check v-else-if="settingsStore.saveSuccess" class="size-4 mr-2" />
          {{ settingsStore.saveSuccess ? t('general.saved') : t('settings.saveButton') }}
        </Button>
      </div>
    </div>
  </div>
</template>
