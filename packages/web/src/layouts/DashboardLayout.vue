<script setup lang="ts">
import AppSidebar from "@/components/layout/AppSidebar.vue";
import AppHeader from "@/components/layout/AppHeader.vue";
import NewConversionDialog from "@/components/dialogs/NewConversionDialog.vue";
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar"
</script>

<template>
  <SidebarProvider>
    <AppSidebar />
    <SidebarInset class="h-screen overflow-hidden flex flex-col">
      <AppHeader title="Agent Manager" />
      <div class="flex-1 min-h-0 overflow-auto">
        <slot></slot>
      </div>
    </SidebarInset>
    <NewConversionDialog />
  </SidebarProvider>
</template>
