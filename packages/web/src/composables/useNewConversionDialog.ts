import { createGlobalState } from "@vueuse/core";
import { ref } from "vue";

export const useNewConversionDialog = createGlobalState(() => {
	const isOpen = ref(false);
	const projectId = ref<string | undefined>(undefined);

	const open = (id?: string) => {
		isOpen.value = true;
		if (id && typeof id === "string") projectId.value = id;
	};
	const close = () => {
		isOpen.value = false;
		projectId.value = undefined;
	};
	return { isOpen, projectId, open, close };
});
