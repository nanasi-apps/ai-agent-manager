<script setup lang="ts">
import type { Project } from "@agent-manager/shared";
import { Play, Square } from "lucide-vue-next";
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { useRoute } from "vue-router";
import { Button } from "@/components/ui/button";
import { orpc } from "@/services/orpc";
import { useProjectsStore } from "@/stores/projects";

const route = useRoute();
const projectsStore = useProjectsStore();

const currentProjectId = computed(() => {
	const path = route.path;
	if (path.startsWith("/projects/")) {
		return path.split("/")[2];
	}
	return null;
});

const currentProject = computed(() => {
	if (!currentProjectId.value) return null;
	// Cast to shared Project type to access launchConfigs
	return projectsStore.getProjectById(currentProjectId.value) as unknown as
		| Project
		| undefined;
});

// Launch Configs
const launchConfigs = computed(() => {
	const proj = currentProject.value;
	if (!proj) return [];

	const configs = [];
	if (proj.launchConfigs && proj.launchConfigs.length > 0) {
		configs.push(...proj.launchConfigs);
	}

	// Fallback if no launchConfigs but autoConfig exists
	if (configs.length === 0 && proj.autoConfig) {
		configs.push({ ...proj.autoConfig, name: "Default" });
	}

	return configs.map((c) => ({
		label: c.name || "Untitled",
		value: c.name || "default",
	}));
});

const selectedConfig = ref<string>("");
const isRunning = ref(false);

// Watch configs to set default selection
watch(
	() => launchConfigs.value,
	(newConfigs) => {
		const safeConfigs = newConfigs || [];
		if (safeConfigs.length > 0) {
			const currentSelected = selectedConfig.value;
			const exists = safeConfigs.some((c) => c && c.value === currentSelected);
			if (!currentSelected || !exists) {
				const firstConfig = safeConfigs[0];
				selectedConfig.value = firstConfig ? firstConfig.value : "";
			}
		} else {
			selectedConfig.value = "";
		}
	},
	{ immediate: true },
);

// Watch project change to reset/check status
watch(currentProjectId, () => {
	checkStatus();
});

async function checkStatus() {
	if (!currentProjectId.value) {
		isRunning.value = false;
		return;
	}
	try {
		const status = await orpc.devServerStatus({
			projectId: currentProjectId.value,
		});
		if (status && status.status === "running") {
			isRunning.value = true;
		} else {
			isRunning.value = false;
		}
	} catch (e) {
		console.error("Failed to check status", e);
		isRunning.value = false;
	}
}

async function toggleRun() {
	if (!currentProjectId.value) return;

	if (isRunning.value) {
		// Stop
		try {
			await orpc.devServerStop({ projectId: currentProjectId.value });
			isRunning.value = false;
		} catch (e) {
			console.error("Failed to stop", e);
		}
	} else {
		// Run
		try {
			await orpc.devServerLaunch({
				projectId: currentProjectId.value,
				configName:
					selectedConfig.value === "Default" ? undefined : selectedConfig.value,
			});
			isRunning.value = true;
			checkStatus();
		} catch (e) {
			console.error("Failed to launch", e);
		}
	}
}

let interval: ReturnType<typeof setInterval>;
onMounted(() => {
	checkStatus();
	interval = setInterval(checkStatus, 2000);
});
onUnmounted(() => clearInterval(interval));
</script>

<template>
	<div
		v-if="currentProject && launchConfigs.length > 0"
		class="border-b px-4 py-2 flex items-center justify-between bg-sidebar"
	>
		<div class="flex items-center gap-2">
			<!-- Optionally show project name here, but it's already in sidebar/breadcrumb -->
		</div>

		<div class="flex items-center gap-2 ml-auto">
			<div
				class="flex items-center gap-2 bg-background rounded-md border shadow-sm p-0.5"
			>
				<!-- Config Selector -->
				<select
					v-model="selectedConfig"
					class="h-7 bg-transparent text-sm border-none focus:ring-0 outline-none px-2 w-[150px] truncate cursor-pointer"
					:disabled="isRunning"
				>
					<option
						v-for="config in launchConfigs"
						:key="config.value"
						:value="config.value"
					>
						{{ config.label }}
					</option>
				</select>

				<div class="w-px h-4 bg-border"></div>

				<!-- Run/Stop Button -->
				<Button
					size="sm"
					variant="ghost"
					class="h-7 w-8 px-0 hover:bg-muted"
					:class="{'text-green-600 hover:text-green-700 hover:bg-green-100': !isRunning, 'text-red-600 hover:text-red-700 hover:bg-red-100': isRunning}"
					@click="toggleRun"
					:title="isRunning ? 'Stop' : 'Run'"
				>
					<component
						:is="isRunning ? Square : Play"
						class="size-4 fill-current"
					/>
				</Button>
			</div>
		</div>
	</div>
</template>
