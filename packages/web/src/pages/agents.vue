<script setup lang="ts">
import { useI18n } from "vue-i18n";

const { t } = useI18n();
</script>

<template>
  <div class="p-6">
    <h1 class="text-2xl font-bold">{{ t('agents.title') }}</h1>
    <p class="text-muted-foreground mt-4">
      {{ t('agents.description') }}
    </p>
  </div>
</template>
