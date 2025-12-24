<script setup lang="ts">
import AppSidebar from "../components/AppSidebar.vue";
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar"
</script>

<template>
  <SidebarProvider>
    <AppSidebar />
    <SidebarInset>

      <div class="flex flex-1 flex-col gap-4 p-4">
        <slot></slot>
      </div>
    </SidebarInset>
  </SidebarProvider>
</template>
