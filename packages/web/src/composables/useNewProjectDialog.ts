import { ref } from 'vue'
import { createGlobalState } from '@vueuse/core'

export const useNewProjectDialog = createGlobalState(() => {
    const isOpen = ref(false)

    const open = () => {
        isOpen.value = true
    }
    const close = () => {
        isOpen.value = false
    }
    return { isOpen, open, close }
})
