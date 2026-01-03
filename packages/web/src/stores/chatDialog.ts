import { defineStore } from "pinia";
import { ref } from "vue";

export const useChatDialogStore = defineStore("chatDialog", () => {
    const isOpen = ref(false);
    const sessionId = ref<string | null>(null);

    function open(id: string) {
        sessionId.value = id;
        isOpen.value = true;
    }

    function close() {
        isOpen.value = false;
        // Don't clear sessionId immediately to allow exit animation
        setTimeout(() => {
            if (!isOpen.value) {
                sessionId.value = null;
            }
        }, 300);
    }

    return { isOpen, sessionId, open, close };
});
