<script setup lang="ts">
import { onMounted, ref } from "vue";
import DashboardLayout from "./layouts/DashboardLayout.vue";
import { orpc } from "./services/orpc";

const ping = ref("no Api Answer");

console.log('App initialization started');

onMounted(async () => {
    console.log('tests - onMounted fired');
	try {
		const response = await orpc.ping();
		console.log("ORPC Ping Response:", response);
		ping.value = response;
	} catch (e) {
		console.error("ORPC Ping Failed:", e);
	}
});
</script>

<template>
  <DashboardLayout>
    <p>Welcome to Agent Manager</p>
    {{ping}}
  </DashboardLayout>
</template>
