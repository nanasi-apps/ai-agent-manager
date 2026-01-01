<script setup lang="ts">
import { useRoute } from "vue-router";
import ConversationView from "@/components/conversation/ConversationView.vue";

const route = useRoute();
</script>

<template>
  <ConversationView :session-id="(route.params as any).id" />
</template>