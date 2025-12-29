<script setup lang="ts">
import { Check, Eye, EyeOff, Key, Loader2 } from "lucide-vue-next";
import { computed, onMounted, ref } from "vue";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { orpc } from "@/services/orpc";

interface ApiSettings {
	openaiApiKey?: string;
	openaiBaseUrl?: string;
	geminiApiKey?: string;
	geminiBaseUrl?: string;
}

// API Settings state
const apiSettings = ref<ApiSettings>({});
const apiLoading = ref(false);
const apiSaving = ref(false);
const apiSaveSuccess = ref(false);

// Form values for editing
const openaiApiKeyInput = ref("");
const openaiBaseUrlInput = ref("");
const geminiApiKeyInput = ref("");
const geminiBaseUrlInput = ref("");

// Visibility toggles
const showOpenaiKey = ref(false);
const showGeminiKey = ref(false);

// Check if keys are configured
const hasOpenaiKey = computed(() => apiSettings.value.openaiApiKey === "***");
const hasGeminiKey = computed(() => apiSettings.value.geminiApiKey === "***");

async function loadApiSettings() {
	apiLoading.value = true;
	try {
		const settings = await orpc.getApiSettings();
		apiSettings.value = settings;
		// Initialize inputs with base URLs (keys are masked)
		openaiBaseUrlInput.value = settings.openaiBaseUrl || "";
		geminiBaseUrlInput.value = settings.geminiBaseUrl || "";
	} catch (err) {
		console.error("Failed to load API settings", err);
	} finally {
		apiLoading.value = false;
	}
}

async function saveApiSettings() {
	apiSaving.value = true;
	apiSaveSuccess.value = false;
	try {
		const updates: Partial<ApiSettings> = {};

		// Only include fields that have been explicitly set
		if (openaiApiKeyInput.value) {
			updates.openaiApiKey = openaiApiKeyInput.value;
		}
		if (openaiBaseUrlInput.value !== (apiSettings.value.openaiBaseUrl || "")) {
			updates.openaiBaseUrl = openaiBaseUrlInput.value || undefined;
		}
		if (geminiApiKeyInput.value) {
			updates.geminiApiKey = geminiApiKeyInput.value;
		}
		if (geminiBaseUrlInput.value !== (apiSettings.value.geminiBaseUrl || "")) {
			updates.geminiBaseUrl = geminiBaseUrlInput.value || undefined;
		}

		if (Object.keys(updates).length > 0) {
			await orpc.updateApiSettings(updates);
			// Clear key inputs after save
			openaiApiKeyInput.value = "";
			geminiApiKeyInput.value = "";
			// Reload to get updated state
			await loadApiSettings();
			apiSaveSuccess.value = true;
			setTimeout(() => {
				apiSaveSuccess.value = false;
			}, 2000);
		}
	} catch (err) {
		console.error("Failed to save API settings", err);
	} finally {
		apiSaving.value = false;
	}
}

async function clearOpenaiKey() {
	apiSaving.value = true;
	try {
		await orpc.updateApiSettings({ openaiApiKey: "" });
		await loadApiSettings();
	} finally {
		apiSaving.value = false;
	}
}

async function clearGeminiKey() {
	apiSaving.value = true;
	try {
		await orpc.updateApiSettings({ geminiApiKey: "" });
		await loadApiSettings();
	} finally {
		apiSaving.value = false;
	}
}

onMounted(() => {
	loadApiSettings();
});
</script>

<template>
  <div class="p-4 space-y-8">
    <div>
      <h1 class="text-2xl font-bold mb-2">Settings</h1>
      <p class="text-muted-foreground">Configure your application settings.</p>
    </div>

    <!-- API Settings Section -->
    <div class="space-y-4">
      <div class="flex items-center gap-2">
        <Key class="size-5" />
        <h2 class="text-xl font-semibold">API Settings</h2>
      </div>
      <p class="text-sm text-muted-foreground">
        Configure API keys for direct API-based agents (OpenAI API, Gemini API).
      </p>

      <div v-if="apiLoading" class="flex items-center gap-2 text-muted-foreground">
        <Loader2 class="size-4 animate-spin" />
        Loading API settings...
      </div>

      <div v-else class="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <!-- OpenAI Settings -->
        <Card>
          <CardHeader>
            <div class="flex items-center justify-between">
              <CardTitle class="text-base">OpenAI API</CardTitle>
              <Badge v-if="hasOpenaiKey" variant="secondary" class="text-green-600">
                <Check class="size-3 mr-1" />
                Configured
              </Badge>
              <Badge v-else variant="outline">Not Set</Badge>
            </div>
            <CardDescription>
              Used for OpenAI API agent and compatible services.
            </CardDescription>
          </CardHeader>
          <CardContent class="space-y-4">
            <div class="space-y-2">
              <Label>API Key</Label>
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
                  Clear
                </Button>
              </div>
            </div>
            <div class="space-y-2">
              <Label>Base URL (optional)</Label>
              <Input
                v-model="openaiBaseUrlInput"
                type="url"
                placeholder="https://api.openai.com/v1"
              />
              <p class="text-xs text-muted-foreground">
                Custom endpoint for Azure OpenAI or compatible APIs.
              </p>
            </div>
          </CardContent>
        </Card>

        <!-- Gemini Settings -->
        <Card>
          <CardHeader>
            <div class="flex items-center justify-between">
              <CardTitle class="text-base">Gemini API</CardTitle>
              <Badge v-if="hasGeminiKey" variant="secondary" class="text-green-600">
                <Check class="size-3 mr-1" />
                Configured
              </Badge>
              <Badge v-else variant="outline">Not Set</Badge>
            </div>
            <CardDescription>
              Used for Gemini API agent.
            </CardDescription>
          </CardHeader>
          <CardContent class="space-y-4">
            <div class="space-y-2">
              <Label>API Key</Label>
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
                  Clear
                </Button>
              </div>
            </div>
            <div class="space-y-2">
              <Label>Base URL (optional)</Label>
              <Input
                v-model="geminiBaseUrlInput"
                type="url"
                placeholder="https://generativelanguage.googleapis.com"
              />
              <p class="text-xs text-muted-foreground">
                Custom endpoint for Gemini API proxy.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      <div class="flex items-center gap-4">
        <Button @click="saveApiSettings" :disabled="apiSaving || apiLoading">
          <Loader2 v-if="apiSaving" class="size-4 mr-2 animate-spin" />
          <Check v-else-if="apiSaveSuccess" class="size-4 mr-2" />
          {{ apiSaveSuccess ? 'Saved!' : 'Save API Settings' }}
        </Button>
      </div>
    </div>
  </div>
</template>
