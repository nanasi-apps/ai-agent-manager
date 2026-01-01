import { createGlobalState } from "@vueuse/core";
import { ref } from "vue";

export const useChatDialog = createGlobalState(() => {
	const isOpen = ref(false);
	const sessionId = ref<string | null>(null);

	const open = (id: string) => {
		sessionId.value = id;
		isOpen.value = true;
	};

	const close = () => {
		isOpen.value = false;
        // Don't clear sessionId immediately to allow exit animation
        setTimeout(() => {
            if (!isOpen.value) {
                sessionId.value = null;
            }
        }, 300);
	};

	return { isOpen, sessionId, open, close };
});
