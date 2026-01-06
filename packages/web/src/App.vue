<script setup lang="ts">
import { storeToRefs } from "pinia";
import { onMounted, watch } from "vue";
import { useI18n } from "vue-i18n";
import BranchNameDialog from "@/components/dialogs/BranchNameDialog.vue";
import NewProjectDialog from "@/components/dialogs/NewProjectDialog.vue";
import DashboardLayout from "@/layouts/DashboardLayout.vue";
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

	const electronAPI = window.electronAPI;

	if (!electronAPI) {
		// Falls back to browser matchMedia if not in Electron
		const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
		const applyTheme = (isDark: boolean) => {
			document.documentElement.classList.toggle("dark", isDark);
		};
		applyTheme(mediaQuery.matches);
		mediaQuery.addEventListener("change", (e) => applyTheme(e.matches));
		return;
	}

	// Get initial theme
	const initialTheme = await electronAPI.getTheme();
	document.documentElement.classList.toggle("dark", initialTheme);

	// Listen for changes
	electronAPI.onThemeChanged((isDark) => {
		document.documentElement.classList.toggle("dark", isDark);
	});
});
</script>

<template>
	<DashboardLayout>
		<router-view/>
	</DashboardLayout>
	<NewProjectDialog v-model:open="isOpen"/>
	<BranchNameDialog/>
</template>
