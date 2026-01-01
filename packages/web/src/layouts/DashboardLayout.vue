<script setup lang="ts">
import { NewConversionDialog, ChatDialog } from "@/components/dialogs";
import AppSidebar from "@/components/layout/AppSidebar.vue";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
</script>

<template>
  <SidebarProvider>
    <AppSidebar />
    <SidebarInset class="h-screen overflow-hidden flex flex-col">
      <div class="flex-1 min-h-0 overflow-auto">
        <slot></slot>
      </div>
    </SidebarInset>
    <NewConversionDialog />
    <ChatDialog />
  </SidebarProvider>
</template>
