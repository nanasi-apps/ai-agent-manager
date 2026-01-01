<script setup lang="ts">
import { useRoute } from "vue-router";
import { computed } from "vue";
import ConversationView from "@/components/conversation/ConversationView.vue";
import { getRouteParamFrom } from "@/lib/route-params";

const route = useRoute();

const sessionId = computed(() => {
	const id = getRouteParamFrom(route.params, "id");
	return id || "new";
});
</script>

<template>
  <ConversationView :session-id="sessionId" />
</template>
