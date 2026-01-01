<script setup lang="ts">
import { onMounted } from "vue";
import { useI18n } from "vue-i18n";
import NewProjectDialog from "@/components/dialogs/NewProjectDialog.vue";
import { useNewProjectDialog } from "@/composables/useNewProjectDialog";
import DashboardLayout from "@/layouts/DashboardLayout.vue";
import { orpc } from "@/services/orpc";

const { isOpen } = useNewProjectDialog();
const { locale } = useI18n();

onMounted(async () => {
	// Load language
	try {
		const settings = await orpc.getAppSettings();
		if (settings.language) {
			locale.value = settings.language;
		}
	} catch (err) {
		console.error("Failed to load language setting", err);
	}

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
    <router-view />
  </DashboardLayout>
  <NewProjectDialog v-model:open="isOpen" />
</template>
