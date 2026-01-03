import { defineStore } from "pinia";
import { ref } from "vue";

export const useNewConversionDialogStore = defineStore(
    "newConversionDialog",
    () => {
        const isOpen = ref(false);
        const projectId = ref<string | undefined>(undefined);

        function open(id?: string) {
            isOpen.value = true;
            if (id) projectId.value = id;
        }

        function close() {
            isOpen.value = false;
            projectId.value = undefined;
        }

        return { isOpen, projectId, open, close };
    },
);
