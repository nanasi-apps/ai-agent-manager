<script setup lang="ts">
import { Dialog, DialogContent } from "@/components/ui/dialog";
import ConversationView from "@/components/conversation/ConversationView.vue";
import { useChatDialog } from "@/composables/useChatDialog";

const { isOpen, sessionId, close } = useChatDialog();
</script>

<template>
  <Dialog :open="isOpen" @update:open="(val) => !val && close()">
    <DialogContent class="max-w-[80vw] w-full h-[85vh] p-0 overflow-hidden flex flex-col gap-0 border-0 bg-background/95 backdrop-blur-xl">
      <div v-if="sessionId" class="flex-1 h-full min-h-0 relative">
          <ConversationView :session-id="sessionId" @close="close" />
      </div>
    </DialogContent>
  </Dialog>
</template>
