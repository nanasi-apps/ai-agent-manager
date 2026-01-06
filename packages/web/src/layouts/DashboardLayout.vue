<script setup lang="ts">
import ChatDialog from "@/components/dialogs/ChatDialog.vue";
import NewConversionDialog from "@/components/dialogs/NewConversionDialog.vue";
import AppSidebar from "@/components/layout/AppSidebar.vue";
import TopBar from "@/components/layout/TopBar.vue";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
</script>

<template>
	<SidebarProvider>
		<AppSidebar/>
		<SidebarInset class="h-screen overflow-hidden flex flex-col">
			<TopBar/>
			<div class="flex-1 min-h-0 overflow-auto">
				<slot></slot>
			</div>
		</SidebarInset>
		<NewConversionDialog/>
		<ChatDialog/>
	</SidebarProvider>
</template>
