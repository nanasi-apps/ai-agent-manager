<script setup lang="ts">
import { onMounted } from "vue";
import NewProjectDialog from "@/components/dialogs/NewProjectDialog.vue";
import { useNewProjectDialog } from "@/composables/useNewProjectDialog";
import DashboardLayout from "@/layouts/DashboardLayout.vue";

const { isOpen } = useNewProjectDialog();

onMounted(async () => {
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