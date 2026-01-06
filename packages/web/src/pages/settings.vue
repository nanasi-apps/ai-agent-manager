<script setup lang="ts">
import { useQuery } from "@tanstack/vue-query";
import { useVirtualizer } from "@tanstack/vue-virtual";
import { watchDebounced } from "@vueuse/core";
import {
	Check,
	ChevronDown,
	Eye,
	EyeOff,
	Globe,
	Key,
	Loader2,
	Search,
} from "lucide-vue-next";
import { computed, nextTick, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { orpc, orpcQuery } from "@/services/orpc";
import { type ApprovalChannel, useSettingsStore } from "@/stores/settings";

const { t, locale } = useI18n();
const settingsStore = useSettingsStore();
const localProviders = ref<any[]>([]);

// Model Management State
const modelSearchQuery = ref("");
const { data: allModels, refetch: refetchModels } = useQuery(
	orpcQuery.listModelTemplates.queryOptions({
		input: { includeDisabled: true },
	}),
);

// Grouping Logic for Models Tab
const modelsByProvider = computed(() => {
	if (!allModels.value || !localProviders.value.length) return [];

	// Iterate over local providers to build structure
	// We only care about models that belong to configured providers
	// We match by providerId attached to model ID (e.g. ::providerId) or we need to match by other means?
	// listModelTemplates now returns `providerId`.

	const groups = localProviders.value
		.map((provider) => {
			const providerModels = allModels.value?.filter(
				(m) => m.providerId === provider.id,
			);

			// Apply search filter
			const filtered = providerModels.filter(
				(m) =>
					!modelSearchQuery.value ||
					m.name.toLowerCase().includes(modelSearchQuery.value.toLowerCase()),
			);

			if (filtered.length === 0) return null;

			// Group by Developer (prefix before /)
			const developerGroups: Record<string, typeof filtered> = {};
			const standaloneModels: typeof filtered = [];

			for (const model of filtered) {
				const parts = model.name.split("/");
				if (parts.length > 1) {
					const devName = parts[0];
					if (devName) {
						if (!developerGroups[devName]) developerGroups[devName] = [];
						developerGroups[devName].push(model);
					}
				} else {
					standaloneModels.push(model);
				}
			}

			return {
				provider,
				developerGroups,
				standaloneModels,
				totalCount: filtered.length,
			};
		})
		.filter((g) => g !== null);

	return groups;
});

// Flat list structure for true virtualization
type FlatItem =
	| { type: "provider-header"; provider: any; totalCount: number; key: string }
	| {
			type: "dev-group-header";
			providerId: string;
			groupName: string;
			models: any[];
			key: string;
	  }
	| { type: "model"; providerId: string; model: any; key: string };

const flatItems = computed(() => {
	const items: FlatItem[] = [];

	for (const group of modelsByProvider.value) {
		// 1. Provider Header
		items.push({
			type: "provider-header",
			provider: group.provider,
			totalCount: group.totalCount,
			key: `provider-${group.provider.id}`,
		});

		// If provider is collapsed (default logic is confusing: !collapsed means OPEN)
		// In template: :open="!collapsedProviders[...]"
		// So if collapsedProviders is TRUE, it is CLOSED.
		// if collapsedProviders is FALSE/Undefined, it is OPEN.
		const isProviderOpen = !collapsedProviders.value[group.provider.id];

		if (isProviderOpen) {
			// 2. Developer Groups
			for (const [devName, models] of Object.entries(group.developerGroups)) {
				const groupKey = `${group.provider.id}::${devName}`;
				items.push({
					type: "dev-group-header",
					providerId: group.provider.id,
					groupName: devName,
					models: models as any[],
					key: `group-${groupKey}`,
				});

				const isGroupOpen = !collapsedDeveloperGroups.value[groupKey];
				if (isGroupOpen) {
					for (const model of models as any[]) {
						items.push({
							type: "model",
							providerId: group.provider.id,
							model,
							key: `model-${model.id}`,
						});
					}
				}
			}

			// 3. Standalone Models
			for (const model of group.standaloneModels) {
				items.push({
					type: "model",
					providerId: group.provider.id,
					model,
					key: `model-${model.id}`,
				});
			}
		}
	}
	return items;
});

// Helper for template
const getVirtualItemData = (index: number): any => flatItems.value[index];

const isModelEnabled = (providerId: string, modelName: string) => {
	const provider = localProviders.value.find((p) => p.id === providerId);
	return !provider?.disabledModels?.includes(modelName);
};

const setModelEnabled = (
	providerId: string,
	modelName: string,
	enabled: boolean,
) => {
	const provider = localProviders.value.find((p) => p.id === providerId);
	if (!provider) return;

	if (!provider.disabledModels) provider.disabledModels = [];

	if (enabled) {
		// Enable: remove from disabledModels
		provider.disabledModels = provider.disabledModels.filter(
			(m: string) => m !== modelName,
		);
	} else {
		// Disable: add to disabledModels
		if (!provider.disabledModels.includes(modelName)) {
			provider.disabledModels.push(modelName);
		}
	}
};

const collapsedProviders = ref<Record<string, boolean>>({});
const collapsedDeveloperGroups = ref<Record<string, boolean>>({});

// Virtual scroll setup for models
const modelsScrollContainerRef = ref<HTMLElement | null>(null);
const parentScrollElement = ref<HTMLElement | null>(null);
const modelsListOffset = ref(0);
const ESTIMATED_ITEM_HEIGHT = 40;

const getScrollParent = (node: HTMLElement | null): HTMLElement => {
	if (!node) return document.documentElement;
	let parent = node.parentElement;
	while (parent) {
		const { overflowY } = window.getComputedStyle(parent);
		if (
			overflowY === "auto" ||
			overflowY === "scroll" ||
			overflowY === "overlay"
		) {
			return parent;
		}
		parent = parent.parentElement;
	}
	return document.documentElement;
};

const updateListOffset = () => {
	if (modelsScrollContainerRef.value && parentScrollElement.value) {
		// If parent is document element, calculation is same as window
		if (
			parentScrollElement.value === document.documentElement ||
			parentScrollElement.value === document.body
		) {
			const rect = modelsScrollContainerRef.value.getBoundingClientRect();
			modelsListOffset.value = rect.top + window.scrollY;
		} else {
			const parentRect = parentScrollElement.value.getBoundingClientRect();
			const containerRect =
				modelsScrollContainerRef.value.getBoundingClientRect();
			modelsListOffset.value =
				containerRect.top -
				parentRect.top +
				parentScrollElement.value.scrollTop;
		}
	}
};

const modelsVirtualizer = useVirtualizer({
	get count() {
		return flatItems.value.length;
	},
	getScrollElement: () => parentScrollElement.value,
	estimateSize: () => ESTIMATED_ITEM_HEIGHT,
	overscan: 20,
	get scrollMargin() {
		return modelsListOffset.value;
	},
});

const virtualModels = computed(() => modelsVirtualizer.value.getVirtualItems());
const totalModelsSize = computed(() => modelsVirtualizer.value.getTotalSize());

// Re-measure when providers expand/collapse or developer groups expand/collapse
watch(
	[collapsedProviders, collapsedDeveloperGroups],
	() => {
		nextTick(() => {
			modelsVirtualizer.value.measure();
		});
	},
	{ deep: true },
);

// Update offset when tab changes or component mounts
watch(
	() => modelsScrollContainerRef.value,
	() => {
		if (modelsScrollContainerRef.value) {
			parentScrollElement.value = getScrollParent(
				modelsScrollContainerRef.value,
			);
			nextTick(updateListOffset);
		}
	},
);

onMounted(() => {
	window.addEventListener("resize", updateListOffset);
	// Initial check
	setTimeout(() => {
		if (modelsScrollContainerRef.value) {
			parentScrollElement.value = getScrollParent(
				modelsScrollContainerRef.value,
			);
			updateListOffset();
		}
	}, 100);
});

// Since we are unmounting, we should cleanup?
// settings.vue is a page, so onUnmounted is fine

const getDeveloperGroupState = (providerId: string, models: any[]) => {
	const total = models.length;
	const enabledCount = models.filter((m) =>
		isModelEnabled(providerId, m.name),
	).length;

	if (enabledCount === 0) return false;
	if (enabledCount === total) return true;
	return "indeterminate";
};

const setDeveloperGroupEnabled = (
	providerId: string,
	models: any[],
	enabled: boolean,
) => {
	for (const m of models) {
		setModelEnabled(providerId, m.name, enabled);
	}
};

const toggleAllModels = (providerId: string, enabled: boolean) => {
	const provider = localProviders.value.find((p) => p.id === providerId);
	if (!provider) return;

	if (!Array.isArray(provider.disabledModels)) {
		provider.disabledModels = [];
	}

	if (!allModels.value) return;

	const providerModels = allModels.value.filter(
		(m) => m.providerId === provider.id,
	);
	if (!enabled) {
		// Disable all found models
		const allNames = providerModels.map((m) => m.name);
		// Add all names to disabledModels, ensuring uniqueness
		provider.disabledModels = [
			...new Set([...provider.disabledModels, ...allNames]),
		];
	} else {
		// Enable all: remove all provider models from disabledModels
		const relevantNames = providerModels.map((m) => m.name);
		provider.disabledModels = provider.disabledModels.filter(
			(m: string) => !relevantNames.includes(m),
		);
	}
};

const { data: webServerStatus, refetch: refetchWebServerStatus } = useQuery(
	orpcQuery.webServer.getStatus.queryOptions({}),
);
const webServerHost = ref("0.0.0.0");
const webServerPort = ref<number | undefined>();
const webServerAutoStart = ref(false);
const webServerAutoOpenBrowser = ref(false);
const isStartingWebServer = ref(false);
const isStoppingWebServer = ref(false);

const normalizePort = (value: string | number | undefined) => {
	if (value === undefined || value === null || value === "") return undefined;
	const parsed = typeof value === "number" ? value : Number(value);
	return Number.isNaN(parsed) ? undefined : parsed;
};

async function startWebServer() {
	if (isStartingWebServer.value) return;
	isStartingWebServer.value = true;
	try {
		const port = normalizePort(webServerPort.value);
		const host = webServerHost.value?.trim() || "0.0.0.0";
		await orpc.webServer.start({
			port,
			host,
		});
		await refetchWebServerStatus();
	} catch (error) {
		console.error("Failed to start web server:", error);
	} finally {
		isStartingWebServer.value = false;
	}
}

async function stopWebServer() {
	if (isStoppingWebServer.value) return;
	isStoppingWebServer.value = true;
	try {
		await orpc.webServer.stop();
		await refetchWebServerStatus();
	} catch (error) {
		console.error("Failed to stop web server:", error);
	} finally {
		isStoppingWebServer.value = false;
	}
}

// Form values for editing (local inputs that get synced to store)
const selectedLanguage = ref("en");
const notifyOnAgentComplete = ref(true);
const approvalNotificationChannels = ref<ApprovalChannel[]>([]);
const newConversionOpenMode = ref<"page" | "dialog">("page");
const slackWebhookUrl = ref("");
const discordWebhookUrl = ref("");

// Visibility toggles
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
	selectedLanguage.value = settingsStore.language;
	locale.value = settingsStore.language;

	notifyOnAgentComplete.value = settingsStore.notifyOnAgentComplete;
	approvalNotificationChannels.value = [
		...settingsStore.approvalNotificationChannels,
	];
	newConversionOpenMode.value = settingsStore.newConversionOpenMode;
	slackWebhookUrl.value = settingsStore.appSettings.slackWebhookUrl || "";
	discordWebhookUrl.value = settingsStore.appSettings.discordWebhookUrl || "";

	webServerAutoStart.value =
		settingsStore.appSettings.webServerAutoStart ?? false;
	webServerAutoOpenBrowser.value =
		settingsStore.appSettings.webServerAutoOpenBrowser ?? false;
	webServerHost.value = settingsStore.appSettings.webServerHost || "0.0.0.0";
	webServerPort.value = settingsStore.appSettings.webServerPort;

	// Sync local providers copy, but preserve local edits if possible?
	// For now, simplistic sync (overwrite local on store update)
	// We need to clone to avoid mutating store directly
	// Also, we need to handle potential 'undefined' for providers
	// NOTE: If we are midway through editing models, refreshing this might kill uncommitted changes?
	// watchDebounced commits changes, which triggers update, which triggers store update, which triggers this watcher.
	// If we blindly overwrite `localProviders` with `settingsStore.providers`, we might lose transient UI state if it's not fast enough?
	// Actually, `settingsStore` is the source of truth for saving. `localProviders` is just a buffer.
	// When `watchDebounced` fires, it saves `localProviders` TO `store`.
	// Then `store` updates and fires this watcher.
	// If we overwrite here, it should be matching what we just saved, so it's fine.
	// Deep clone to ensure reactivity break
	localProviders.value = JSON.parse(
		JSON.stringify(settingsStore.providers || []),
	);
	refetchModels(); // Reload models when settings change (in case API keys changed)
}

async function loadSettings() {
	await settingsStore.loadSettings();
	syncFromStore();
}

async function saveSettings() {
	const appUpdates: Record<string, unknown> = {};

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
	if (
		webServerAutoStart.value !==
		(settingsStore.appSettings.webServerAutoStart ?? false)
	) {
		appUpdates.webServerAutoStart = webServerAutoStart.value;
	}
	if (
		webServerAutoOpenBrowser.value !==
		(settingsStore.appSettings.webServerAutoOpenBrowser ?? false)
	) {
		appUpdates.webServerAutoOpenBrowser = webServerAutoOpenBrowser.value;
	}
	if (
		webServerHost.value !==
		(settingsStore.appSettings.webServerHost || "0.0.0.0")
	) {
		appUpdates.webServerHost = webServerHost.value || undefined;
	}
	const normalizedWebServerPort = normalizePort(webServerPort.value);
	if (normalizedWebServerPort !== settingsStore.appSettings.webServerPort) {
		appUpdates.webServerPort = normalizedWebServerPort;
	}
	if (
		slackWebhookUrl.value !== (settingsStore.appSettings.slackWebhookUrl || "")
	) {
		appUpdates.slackWebhookUrl = slackWebhookUrl.value || undefined;
	}
	if (
		discordWebhookUrl.value !==
		(settingsStore.appSettings.discordWebhookUrl || "")
	) {
		appUpdates.discordWebhookUrl = discordWebhookUrl.value || undefined;
	}

	try {
		if (Object.keys(appUpdates).length > 0) {
			await settingsStore.updateAppSettings(appUpdates);
		}

		// Update API providers
		// We send the current state of localProviders
		// The backend handles masked keys (***) by preserving existing values
		if (localProviders.value) {
			await settingsStore.updateApiSettings({
				providers: localProviders.value,
			});
		}

		// Update locale immediately
		if (appUpdates.language) {
			locale.value = appUpdates.language as string;
		}
	} catch (err) {
		console.error("Failed to save settings", err);
	}
}

const newProvider = ref({
	name: "",
	type: "codex" as "codex" | "gemini",
	baseUrl: "",
	envKey: "",
	apiKey: "",
});

const isNewProviderValid = computed(() => {
	if (!newProvider.value.name) return false;
	if (newProvider.value.type === "codex") {
		return !!newProvider.value.envKey;
	}
	if (newProvider.value.type === "gemini") {
		return !!newProvider.value.apiKey;
	}
	return true;
});

async function addProvider() {
	if (!isNewProviderValid.value) return;

	const id = crypto.randomUUID();
	let provider: any;
	if (newProvider.value.type === "codex") {
		provider = {
			id,
			name: newProvider.value.name,
			type: "codex",
			baseUrl: newProvider.value.baseUrl || undefined,
			envKey: newProvider.value.envKey,
			apiKey: newProvider.value.apiKey || undefined,
		};
	} else {
		provider = {
			id,
			name: newProvider.value.name,
			type: "gemini",
			baseUrl: newProvider.value.baseUrl || undefined,
			apiKey: newProvider.value.apiKey || undefined,
		};
	}

	newProvider.value = {
		name: "",
		type: "codex",
		baseUrl: "",
		envKey: "",
		apiKey: "",
	};
	localProviders.value.push(provider);
}

function deleteProvider(index: number) {
	localProviders.value.splice(index, 1);
}

// Auto-save watcher
watchDebounced(
	[
		selectedLanguage,
		notifyOnAgentComplete,
		approvalNotificationChannels,
		newConversionOpenMode,
		webServerAutoStart,
		webServerAutoOpenBrowser,
		webServerHost,
		webServerPort,
		slackWebhookUrl,
		discordWebhookUrl,
		localProviders,
	],
	() => {
		saveSettings();
	},
	{ debounce: 1000, maxWait: 5000, deep: true },
);

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

		<Tabs defaultValue="settings" class="w-full">
			<TabsList class="mb-4">
				<TabsTrigger value="settings">
					{{ t('settings.generalSettings') }}
				</TabsTrigger>
				<TabsTrigger value="models">Model Settings</TabsTrigger>
			</TabsList>

			<TabsContent value="settings">
				<div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
					<Card>
						<CardHeader>
							<CardTitle class="text-base">
								{{ t('settings.language') }}
							</CardTitle>
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
							<CardTitle class="text-base">
								{{ t('settings.notifications.title') }}
							</CardTitle>
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
											<div
												v-if="isApprovalChannelEnabled('slack')"
												class="relative"
											>
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
													<EyeOff v-if="showSlackWebhook" class="size-3"/>
													<Eye v-else class="size-3"/>
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
											<div
												v-if="isApprovalChannelEnabled('discord')"
												class="relative"
											>
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
													<EyeOff v-if="showDiscordWebhook" class="size-3"/>
													<Eye v-else class="size-3"/>
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
							<CardTitle class="text-base">
								{{ t('settings.newConversion.title') }}
							</CardTitle>
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
									<option value="page">
										{{ t('settings.newConversion.page') }}
									</option>
									<option value="dialog">
										{{ t('settings.newConversion.dialog') }}
									</option>
								</select>
							</div>
						</CardContent>
					</Card>
				</div>

				<!-- Web Server Section -->
				<div class="space-y-4">
					<div class="flex items-center gap-2">
						<Globe class="size-5"/>
						<h2 class="text-xl font-semibold">
							{{ t('settings.webServer.title') }}
						</h2>
					</div>
					<p class="text-sm text-muted-foreground">
						{{ t('settings.webServer.desc') }}
					</p>

					<Card>
						<CardHeader>
							<div class="flex items-center justify-between">
								<CardTitle class="text-base">
									{{ t('settings.webServer.status') }}
								</CardTitle>
								<Badge
									v-if="webServerStatus?.isRunning"
									variant="secondary"
									class="text-green-600"
								>
									<Check class="size-3 mr-1"/>
									{{ t('settings.webServer.running') }}
								</Badge>
								<Badge v-else variant="outline">
									{{ t('settings.webServer.stopped') }}
								</Badge>
							</div>
							<CardDescription>
								{{ t('settings.webServer.statusDesc') }}
							</CardDescription>
						</CardHeader>
						<CardContent class="space-y-4">
							<div class="space-y-2">
								<div class="flex items-center gap-3">
									<Checkbox
										id="webserver-auto-start"
										:checked="webServerAutoStart"
										@update:checked="(checked: boolean | 'indeterminate') => {
                   webServerAutoStart = checked === true;
                 }"
									/>
									<Label
										for="webserver-auto-start"
										class="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer select-none"
									>
										{{ t('settings.webServer.autoStart') }}
									</Label>
								</div>
								<div class="flex items-center gap-3 pl-6">
									<Checkbox
										id="webserver-auto-open"
										:checked="webServerAutoOpenBrowser"
										:disabled="!webServerAutoStart"
										@update:checked="(checked: boolean | 'indeterminate') => {
                   webServerAutoOpenBrowser = checked === true;
                 }"
									/>
									<Label
										for="webserver-auto-open"
										:class="['text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer select-none', { 'opacity-60': !webServerAutoStart }]"
									>
										{{ t('settings.webServer.autoOpen') }}
									</Label>
								</div>
							</div>

							<div v-if="webServerStatus?.isRunning" class="space-y-2">
								<div
									v-if="webServerStatus.localUrl"
									class="flex items-center gap-2"
								>
									<span class="text-sm font-medium">Local:</span>
									<a
										:href="webServerStatus.localUrl"
										target="_blank"
										class="text-sm text-blue-500 hover:underline"
										>{{ webServerStatus.localUrl }}</a
									>
								</div>
								<div
									v-if="webServerStatus.networkUrl"
									class="flex items-center gap-2"
								>
									<span class="text-sm font-medium">Network:</span>
									<a
										:href="webServerStatus.networkUrl"
										target="_blank"
										class="text-sm text-blue-500 hover:underline"
										>{{ webServerStatus.networkUrl }}</a
									>
								</div>
							</div>

							<div class="grid grid-cols-1 md:grid-cols-2 gap-4">
								<div class="space-y-2">
									<Label>{{ t('settings.webServer.host') }}</Label>
									<Input
										v-model="webServerHost"
										placeholder="0.0.0.0"
										:disabled="webServerStatus?.isRunning"
									/>
								</div>
								<div class="space-y-2">
									<Label>{{ t('settings.webServer.port') }}(Optional)</Label>
									<Input
										type="number"
										v-model="webServerPort"
										placeholder="Random"
										:disabled="webServerStatus?.isRunning"
									/>
								</div>
							</div>

							<div class="flex items-center gap-2">
								<Button
									v-if="!webServerStatus?.isRunning"
									@click="startWebServer"
									:disabled="isStartingWebServer"
								>
									<Loader2
										v-if="isStartingWebServer"
										class="size-4 mr-2 animate-spin"
									/>
									{{ t('settings.webServer.start') }}
								</Button>
								<Button
									v-else
									variant="destructive"
									@click="stopWebServer"
									:disabled="isStoppingWebServer"
								>
									<Loader2
										v-if="isStoppingWebServer"
										class="size-4 mr-2 animate-spin"
									/>
									{{ t('settings.webServer.stop') }}
								</Button>
							</div>
						</CardContent>
					</Card>
				</div>

				<!-- API Settings Section -->
				<div class="space-y-4">
					<div class="flex items-center gap-2">
						<Key class="size-5"/>
						<h2 class="text-xl font-semibold">
							{{ t('settings.apiSettings') }}
						</h2>
					</div>

					<p class="text-sm text-muted-foreground">
						{{ t('settings.apiSettingsDesc') }}
					</p>

					<div
						v-if="settingsStore.isLoading"
						class="flex items-center gap-2 text-muted-foreground"
					>
						<Loader2 class="size-4 animate-spin"/>
						{{ t('settings.loading') }}
					</div>

					<div class="space-y-6">
						<!-- Add New Provider -->
						<Card>
							<CardHeader>
								<CardTitle class="text-base">Add New Model Provider</CardTitle>
								<CardDescription>
									Add a new model provider (Codex or Gemini)
								</CardDescription>
							</CardHeader>
							<CardContent class="space-y-4">
								<div class="space-y-2">
									<Label>Name</Label>
									<Input v-model="newProvider.name" placeholder="My Provider"/>
								</div>
								<div class="space-y-2">
									<Label>Type</Label>
									<select
										v-model="newProvider.type"
										class="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
									>
										<option value="codex">Codex (OpenAI Compatible API)</option>
										<option value="gemini">Gemini</option>
									</select>
								</div>
								<div class="space-y-2">
									<Label>API Base URL</Label>
									<Input
										v-model="newProvider.baseUrl"
										placeholder="https://api.example.com/v1"
									/>
								</div>

								<!-- Codex Specific -->
								<div v-if="newProvider.type === 'codex'" class="space-y-4">
									<div class="space-y-2">
										<Label>Env Key Name</Label>
										<Input
											v-model="newProvider.envKey"
											placeholder="OPENAI_API_KEY"
										/>
										<p class="text-xs text-muted-foreground">
											The environment variable name to inject the key as.
										</p>
									</div>
									<div class="space-y-2">
										<Label>API Key</Label>
										<Input
											v-model="newProvider.apiKey"
											type="password"
											placeholder="sk-..."
										/>
									</div>
								</div>

								<!-- Gemini Specific -->
								<div v-if="newProvider.type === 'gemini'" class="space-y-4">
									<div class="space-y-2">
										<Label>API Key</Label>
										<Input
											v-model="newProvider.apiKey"
											type="password"
											placeholder="AIza..."
										/>
									</div>
								</div>

								<div class="flex justify-end">
									<Button @click="addProvider" :disabled="!isNewProviderValid">
										<Check class="size-4 mr-2"/>
										Add Provider
									</Button>
								</div>
							</CardContent>
						</Card>

						<!-- Existing Providers -->
						<div v-if="settingsStore.providers.length > 0" class="space-y-4">
							<div class="flex items-center gap-2">
								<h3 class="text-lg font-semibold">Configured Providers</h3>
							</div>
							<div
								v-for="(provider, index) in localProviders"
								:key="provider.id"
							>
								<Card>
									<CardHeader>
										<div class="flex items-center justify-between">
											<div class="font-semibold">{{ provider.name }}</div>
											<Badge variant="secondary">{{ provider.type }}</Badge>
										</div>
										<CardDescription class="text-xs text-muted-foreground">
											ID: {{ provider.id }}
										</CardDescription>
									</CardHeader>
									<CardContent class="space-y-4">
										<div class="space-y-2">
											<Label>API Base URL</Label>
											<Input v-model="provider.baseUrl"/>
										</div>

										<div
											v-if="provider.type === 'codex' || provider.type === 'openai' || provider.type === 'openai_compatible'"
											class="space-y-4"
										>
											<div class="space-y-2">
												<Label>Env Key Name</Label>
												<Input v-model="(provider as any).envKey"/>
											</div>
											<div class="space-y-2">
												<Label>API Key</Label>
												<div class="flex gap-2">
													<Input
														v-model="provider.apiKey"
														type="password"
														:placeholder="provider.apiKey === '***' ? '••••••••' : ''"
													/>
												</div>
											</div>
										</div>

										<div v-if="provider.type === 'gemini'" class="space-y-4">
											<div class="space-y-2">
												<Label>API Key</Label>
												<div class="flex gap-2">
													<Input
														v-model="provider.apiKey"
														type="password"
														:placeholder="provider.apiKey === '***' ? '••••••••' : ''"
													/>
												</div>
											</div>
										</div>

										<div class="flex items-center justify-between mt-4">
											<Button
												variant="destructive"
												size="sm"
												@click="deleteProvider(index)"
											>
												Delete
											</Button>
										</div>
									</CardContent>
								</Card>
							</div>
						</div>
					</div>
				</div>
			</TabsContent><!-- End Settings Tab -->

			<TabsContent value="models">
				<div class="space-y-6">
					<div class="flex items-center justify-between">
						<div>
							<h2 class="text-xl font-semibold">Model Configuration</h2>
							<p class="text-sm text-muted-foreground">
								Manage available models for each provider.
							</p>
						</div>
						<div class="relative w-64">
							<Search
								class="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground"
							/>
							<Input
								v-model="modelSearchQuery"
								placeholder="Search models..."
								class="pl-8"
							/>
						</div>
					</div>

					<div
						v-if="!localProviders.length"
						class="text-center py-8 text-muted-foreground"
					>
						No providers configured. Add a provider in Settings first.
					</div>

					<div v-else ref="modelsScrollContainerRef">
						<div
							class="relative w-full"
							:style="{ height: `${Math.max(0, totalModelsSize - modelsListOffset)}px` }"
						>
							<div
								v-for="virtualRow in virtualModels"
								:key="String(virtualRow.key)"
								:ref="(el) => {
                        if (el) modelsVirtualizer.measureElement(el as HTMLElement)
                     }"
								:data-index="virtualRow.index"
								class="absolute top-0 left-0 w-full"
								:style="{ transform: `translateY(${virtualRow.start - modelsListOffset}px)` }"
							>
								<!-- Provider Header -->
								<div
									v-if="getVirtualItemData(virtualRow.index)?.type === 'provider-header'"
									class="flex items-center justify-between p-4 bg-muted/20 border-b"
								>
									<div
										class="flex items-center gap-2 cursor-pointer"
										@click="collapsedProviders[getVirtualItemData(virtualRow.index).provider.id] = !collapsedProviders[getVirtualItemData(virtualRow.index).provider.id]"
									>
										<Button
											variant="ghost"
											size="sm"
											class="p-0 hover:bg-transparent"
										>
											<ChevronDown
												class="h-4 w-4 transition-transform duration-200"
												:class="{ '-rotate-90': collapsedProviders[getVirtualItemData(virtualRow.index).provider.id] }"
											/>
										</Button>
										<div>
											<h3 class="text-lg font-medium">
												<span class="capitalize"
													>{{ getVirtualItemData(virtualRow.index).provider.type }}</span
												>
												<span
													v-if="getVirtualItemData(virtualRow.index).provider.name.toLowerCase() !== getVirtualItemData(virtualRow.index).provider.type.toLowerCase()"
												>
													-
													{{ getVirtualItemData(virtualRow.index).provider.name }}
												</span>
											</h3>
											<div class="text-xs text-muted-foreground">
												{{ getVirtualItemData(virtualRow.index).totalCount }}
												models
											</div>
										</div>
									</div>
									<div class="flex gap-2">
										<Button
											variant="outline"
											size="sm"
											@click.stop="toggleAllModels(getVirtualItemData(virtualRow.index).provider.id, true)"
										>
											Enable All
										</Button>
										<Button
											variant="outline"
											size="sm"
											@click.stop="toggleAllModels(getVirtualItemData(virtualRow.index).provider.id, false)"
										>
											Disable All
										</Button>
									</div>
								</div>

								<!-- Developer Group Header -->
								<div
									v-else-if="getVirtualItemData(virtualRow.index)?.type === 'dev-group-header'"
									class="flex items-center gap-2 font-medium text-sm bg-muted/10 p-2 pl-8 border-b cursor-pointer hover:bg-muted/20"
									@click="collapsedDeveloperGroups[`${getVirtualItemData(virtualRow.index).providerId}::${getVirtualItemData(virtualRow.index).groupName}`] = !collapsedDeveloperGroups[`${getVirtualItemData(virtualRow.index).providerId}::${getVirtualItemData(virtualRow.index).groupName}`]"
								>
									<Button
										variant="ghost"
										size="sm"
										class="p-0 h-4 w-4 hover:bg-transparent mr-1"
									>
										<ChevronDown
											class="h-3 w-3 transition-transform duration-200"
											:class="{ '-rotate-90': collapsedDeveloperGroups[`${getVirtualItemData(virtualRow.index).providerId}::${getVirtualItemData(virtualRow.index).groupName}`] }"
										/>
									</Button>

									<Checkbox
										:model-value="getDeveloperGroupState(getVirtualItemData(virtualRow.index).providerId, getVirtualItemData(virtualRow.index).models)"
										@update:model-value="(checked: boolean | 'indeterminate') => setDeveloperGroupEnabled(getVirtualItemData(virtualRow.index).providerId, getVirtualItemData(virtualRow.index).models, checked === true)"
										@click.stop
									/>
									<span
										>{{ getVirtualItemData(virtualRow.index).groupName }}</span
									>
									<span class="text-xs text-muted-foreground ml-auto"
										>{{ getVirtualItemData(virtualRow.index).models.length }}
										models</span
									>
								</div>

								<!-- Model Item -->
								<div
									v-else-if="getVirtualItemData(virtualRow.index)?.type === 'model'"
									class="flex items-center gap-2 p-2 pl-12 border-b hover:bg-muted/50"
								>
									<Checkbox
										:id="getVirtualItemData(virtualRow.index).model.id"
										:model-value="isModelEnabled(getVirtualItemData(virtualRow.index).providerId, getVirtualItemData(virtualRow.index).model.name)"
										@update:model-value="(checked: boolean | 'indeterminate') => setModelEnabled(getVirtualItemData(virtualRow.index).providerId, getVirtualItemData(virtualRow.index).model.name, checked === true)"
									/>
									<Label
										:for="getVirtualItemData(virtualRow.index).model.id"
										class="text-sm truncate cursor-pointer"
										:title="getVirtualItemData(virtualRow.index).model.name"
									>
										{{ getVirtualItemData(virtualRow.index).model.name }}
									</Label>
								</div>
							</div>
						</div>
					</div>
				</div>
			</TabsContent>
		</Tabs>
	</div>
</template>
