<script setup lang="ts">
import { storeToRefs } from "pinia";
import { onMounted, watch } from "vue";
import { useI18n } from "vue-i18n";
import BranchNameDialog from "@/components/dialogs/BranchNameDialog.vue";
import NewProjectDialog from "@/components/dialogs/NewProjectDialog.vue";
import DashboardLayout from "@/layouts/DashboardLayout.vue";
import { orpc } from "@/services/orpc";
import { useBranchNameDialogStore } from "@/stores/branchNameDialog";
import { useNewProjectDialogStore } from "@/stores/newProjectDialog";
import { useSettingsStore } from "@/stores/settings";

const projectStore = useNewProjectDialogStore();
const { isOpen } = storeToRefs(projectStore);
const settingsStore = useSettingsStore();
const branchDialogStore = useBranchNameDialogStore();
const { locale } = useI18n();

// Watch for language changes from settings store
watch(
	() => settingsStore.language,
	(newLanguage) => {
		if (newLanguage) {
			locale.value = newLanguage;
		}
	},
);

onMounted(async () => {
	// Load settings (language will be set via watcher)
	await settingsStore.loadSettings();
	if (settingsStore.language) {
		locale.value = settingsStore.language;
	}
	branchDialogStore.setupListeners();

	// Browser fallback setup (used if oRPC fails)
	const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
	const applyTheme = (isDark: boolean) => {
		document.documentElement.classList.toggle("dark", isDark);
	};

	// Try to sync with backend (Electron or Web Server) via oRPC
	try {
		// Initial theme
		const initialTheme = await orpc.electron.theme.get();
		document.documentElement.classList.toggle("dark", initialTheme);

		// Subscribe to changes
		const iterator = await orpc.electron.theme.subscribe();
		for await (const event of iterator) {
			document.documentElement.classList.toggle("dark", event.isDark);
		}
	} catch (err) {
		console.warn(
			"Failed to setup theme via oRPC, falling back to media query:",
			err,
		);
		// Fallback to media query if oRPC fails
		applyTheme(mediaQuery.matches);
		mediaQuery.addEventListener("change", (e) => applyTheme(e.matches));
	}
});
</script>

<template>
	<DashboardLayout>
		<router-view/>
	</DashboardLayout>
	<NewProjectDialog v-model:open="isOpen"/>
	<BranchNameDialog/>
</template>
