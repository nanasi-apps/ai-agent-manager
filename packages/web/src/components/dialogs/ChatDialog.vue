<script setup lang="ts">
import { storeToRefs } from "pinia";
import ConversationView from "@/components/conversation/ConversationView.vue";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { useChatDialogStore } from "@/stores/chatDialog";

const store = useChatDialogStore();
const { isOpen, sessionId } = storeToRefs(store);
</script>

<template>
	<Dialog :open="isOpen" @update:open="(val) => !val && store.close()">
		<DialogContent
			class="max-w-[80vw] w-full h-[85vh] p-0 overflow-hidden flex flex-col gap-0 border-0 bg-background/95 backdrop-blur-xl"
		>
			<div v-if="sessionId" class="flex-1 h-full min-h-0 relative">
				<ConversationView :session-id="sessionId" @close="store.close"/>
			</div>
		</DialogContent>
	</Dialog>
</template>
