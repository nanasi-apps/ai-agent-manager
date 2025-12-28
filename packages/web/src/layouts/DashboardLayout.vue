<script setup lang="ts">
import AppSidebar from "@/components/layout/AppSidebar.vue";
import NewConversionDialog from "@/components/dialogs/NewConversionDialog.vue";
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar"
</script>

<template>
  <SidebarProvider>
    <AppSidebar />
    <SidebarInset class="h-screen overflow-hidden">
      <div class="flex flex-1 flex-col h-full overflow-auto">
        <slot></slot>
      </div>
    </SidebarInset>
    <NewConversionDialog />
  </SidebarProvider>
</template>
