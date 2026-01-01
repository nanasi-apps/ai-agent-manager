<script setup lang="ts">
import { useRoute } from "vue-router";
import { computed } from "vue";
import ConversationView from "@/components/conversation/ConversationView.vue";

const route = useRoute();

const sessionId = computed(() => {
    const id = (route.params as any).id;
    return id || 'new';
});
</script>

<template>
  <ConversationView :session-id="sessionId" />
</template>