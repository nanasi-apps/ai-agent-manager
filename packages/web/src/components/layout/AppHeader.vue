<template>
  <header class="h-14 bg-neutral-800 border-b border-neutral-700 flex items-center justify-between px-4 shrink-0">
    <h1 class="m-0 text-base font-normal">{{ title }}</h1>
    
    <!-- Platform Badge (Hidden by default, visual indicator logic processed in JS) -->
    <span class="hidden px-2 py-1 rounded text-xs font-bold uppercase"
          :class="platform === 'electron' ? 'bg-blue-600 text-white' : 'bg-green-500 text-gray-900'">
          {{ platform }} Mode
        </span>
  </header>
</template>

<script setup lang="ts">
import { onMounted, ref } from "vue";

defineProps<{
	title: string;
}>();

const platform = ref<string>("loading...");

onMounted(() => {
    if (window.electronAPI) {
        platform.value = 'electron';
    } else {
        platform.value = 'web';
    }
});
</script>
