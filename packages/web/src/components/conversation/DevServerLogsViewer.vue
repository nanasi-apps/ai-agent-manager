<script setup lang="ts">
import { Terminal } from "lucide-vue-next";
import { nextTick, onUnmounted, ref, watch } from "vue";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useConversationStore } from "@/stores/conversation";

const props = defineProps<{
	open: boolean;
	projectId: string;
	conversationId: string;
}>();

const emit = defineEmits<(e: "update:open", value: boolean) => void>();

const conversation = useConversationStore();
const logs = ref<string[]>([]);
const polling = ref<NodeJS.Timeout | null>(null);

const fetchLogs = async () => {
	try {
		logs.value = await conversation.fetchDevServerLogs(
			props.projectId,
			props.conversationId,
		);
		scrollToBottom();
	} catch (e) {
		console.error("Failed to fetch logs:", e);
	}
};

const logsEndRef = ref<HTMLElement | null>(null);
const scrollToBottom = async () => {
	await nextTick();
	if (logsEndRef.value) {
		logsEndRef.value.scrollIntoView({ behavior: "smooth" });
	}
};

watch(
	() => props.open,
	(isOpen) => {
		if (isOpen) {
			fetchLogs();
			polling.value = setInterval(fetchLogs, 2000);
		} else {
			if (polling.value) {
				clearInterval(polling.value);
				polling.value = null;
			}
		}
	},
);

onUnmounted(() => {
	if (polling.value) clearInterval(polling.value);
});
</script>

<template>
    <Dialog :open="open" @update:open="emit('update:open', $event)">
        <DialogContent class="max-w-4xl h-[80vh] flex flex-col p-0 gap-0 overflow-hidden outline-none">
             <DialogHeader class="px-6 py-4 border-b bg-muted/20">
                <DialogTitle class="flex items-center gap-2">
                    <Terminal class="w-5 h-5 text-muted-foreground" />
                    Dev Server Logs
                </DialogTitle>
                <DialogDescription>
                    Live logs from the running development server.
                </DialogDescription>
             </DialogHeader>
             <div class="flex-1 min-h-0 bg-black text-green-400 font-mono text-xs p-0 relative group">
                 <ScrollArea class="h-full w-full p-4">
                     <div v-if="logs.length === 0" class="text-zinc-500 italic p-2">No logs available...</div>
                     <div v-else class="flex flex-col">
                        <div v-for="(line, i) in logs" :key="i" class="whitespace-pre-wrap break-all leading-tight">{{ line }}</div>
                        <div ref="logsEndRef" class="h-1"></div>
                     </div>
                 </ScrollArea>
             </div>
        </DialogContent>
    </Dialog>
</template>
