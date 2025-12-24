<template>
  <div class="flex w-screen h-screen bg-neutral-900 text-gray-200 overflow-hidden">
    <AppSidebar />

    <!-- Main Content -->
    <main class="flex-1 flex flex-col h-full relative min-w-0">
      <AppHeader :title="currentTitle" />
      
      <div class="flex-1 p-4 overflow-y-auto">
        <slot></slot>
      </div>
    </main>
  </div>
</template>

<script setup lang="ts">
import { ref } from "vue";
import AppHeader from "../components/AppHeader.vue";
import AppSidebar from "../components/AppSidebar.vue";

const currentTitle = ref("Dashboard");
</script>
