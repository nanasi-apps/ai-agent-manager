<script setup lang="ts">
import { useRoute } from 'vue-router'

const route = useRoute()
</script>

<template>
  <div class="p-4">
    <h1 class="text-2xl font-bold mb-4">Conversion Viewer</h1>
    <p>Viewing conversion: {{ route.params.id }}</p>
  </div>
</template>
