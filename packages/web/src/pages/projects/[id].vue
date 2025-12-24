<script setup lang="ts">
import { useRoute } from 'vue-router'

const route = useRoute()
</script>

<template>
  <div class="p-4">
    <h1 class="text-2xl font-bold mb-4">Project Viewer</h1>
    <p>Viewing project: {{ route.params.id }}</p>
  </div>
</template>
