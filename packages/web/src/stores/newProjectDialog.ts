import { defineStore } from "pinia";
import { ref } from "vue";

export const useNewProjectDialogStore = defineStore("newProjectDialog", () => {
	const isOpen = ref(false);

	function open() {
		isOpen.value = true;
	}

	function close() {
		isOpen.value = false;
	}

	return { isOpen, open, close };
});
