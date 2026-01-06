<script setup lang="ts">
import {
	ChevronDown,
	ChevronRight,
	Loader2,
	Plug,
	Server,
	Terminal,
	X,
} from "lucide-vue-next";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
	type McpServerEntry,
	type McpTool,
	useConversationStore,
} from "@/stores/conversation";

const conversation = useConversationStore();

const getMcpConnectionInfo = (server: McpServerEntry) => {
	if (server.config.url) {
		return server.config.url;
	}
	if (server.config.command) {
		const args = server.config.args?.join(" ") || "";
		return `${server.config.command} ${args}`.trim();
	}
	return "—";
};

const isToolDisabled = (server: McpServerEntry, tool: McpTool) => {
	return conversation.disabledMcpTools.has(`${server.name}-${tool.name}`);
};

const getServerKey = (server: McpServerEntry) =>
	`${server.source}-${server.name}`;

const isServerExpanded = (server: McpServerEntry) => {
	return conversation.expandedMcpServer === getServerKey(server);
};

const handleClose = () => {
	conversation.isMcpSheetOpen = false;
};

const handleToggleServer = (server: McpServerEntry) => {
	conversation.toggleMcpServer(server);
};

const handleToggleTool = async (server: McpServerEntry, tool: McpTool) => {
	await conversation.handleToolClick(server, tool);
};
</script>

<template>
	<div class="h-12 border-b px-4 flex items-center justify-between shrink-0">
		<div class="flex items-center gap-2 font-semibold text-sm">
			<Plug class="size-4" />
			MCP Servers
			<Badge v-if="conversation.mcpAgentType" variant="outline" class="text-[10px] h-5 ml-1">
				{{ conversation.mcpAgentType }}
			</Badge>
		</div>
		<Button variant="ghost" size="icon" class="size-7" @click="handleClose">
			<X class="size-4" />
		</Button>
	</div>

	<ScrollArea class="flex-1 min-h-0 h-full">
		<div class="p-4 space-y-6">
			<div v-if="conversation.isLoadingMcp" class="flex items-center justify-center py-8">
				<Loader2 class="size-6 animate-spin text-muted-foreground" />
			</div>

			<template v-else>
				<!-- Session-specific (Injected) MCP Servers -->
				<div>
					<h3 class="text-sm font-semibold mb-3 flex items-center gap-2">
						<Server class="size-4 text-primary" />
						Injected Servers
					</h3>
					<div
						v-if="conversation.sessionMcpServers.length === 0"
						class="text-sm text-muted-foreground italic pl-6"
					>
						No injected servers for this session.
					</div>
					<div v-else class="space-y-2">
						<div
							v-for="server in conversation.sessionMcpServers"
							:key="`session-${server.name}`"
							class="p-3 rounded-lg border bg-card cursor-pointer hover:border-primary/50 transition-colors"
							@click="handleToggleServer(server)"
						>
							<div class="flex items-center justify-between">
								<div class="flex items-center gap-2">
									<component
										:is="isServerExpanded(server) ? ChevronDown : ChevronRight"
										class="size-3.5 text-muted-foreground"
									/>
									<span class="font-medium text-sm">{{ server.name }}</span>
								</div>
								<Badge variant="secondary" class="text-xs">
									{{ server.config.url ? server.config.type || "HTTP" : "stdio" }}
								</Badge>
							</div>
							<p class="text-xs text-muted-foreground mt-1 font-mono truncate pl-5">
								{{ getMcpConnectionInfo(server) }}
							</p>

							<!-- Tools List -->
							<Transition name="accordion">
								<div
									v-if="isServerExpanded(server)"
									class="mt-3 border-primary/20 space-y-2 py-1"
									@click.stop
								>
									<div v-if="conversation.isLoadingMcpTools" class="flex items-center gap-2 py-2">
										<Loader2 class="size-3 animate-spin text-muted-foreground" />
										<span class="text-xs text-muted-foreground">Loading tools...</span>
									</div>
									<div v-else-if="conversation.mcpToolsError" class="text-xs text-red-500 py-2">
										{{ conversation.mcpToolsError }}
									</div>
									<div
										v-else-if="conversation.mcpServerTools.length === 0"
										class="text-xs text-muted-foreground py-2 italic"
									>
										No tools found.
									</div>
									<div v-else class="grid gap-2">
										<div
											v-for="tool in conversation.mcpServerTools"
											:key="tool.name"
											class="group/tool bg-muted/20 rounded p-2 border border-transparent hover:border-border transition-colors cursor-pointer select-none"
											:class="{ 'opacity-50 grayscale': isToolDisabled(server, tool) }"
											@click="handleToggleTool(server, tool)"
										>
											<div class="flex items-center justify-between gap-2 overflow-hidden">
												<span
													class="text-xs font-mono font-bold text-primary truncate"
													:title="tool.name"
													>{{ tool.name }}</span
												>
											</div>
											<p
												v-if="tool.description"
												class="text-[10px] text-muted-foreground mt-1 line-clamp-2"
											>
												{{ tool.description }}
											</p>
										</div>
									</div>
								</div>
							</Transition>
						</div>
					</div>
				</div>

				<!-- General (Global) MCP Servers -->
				<div>
					<h3 class="text-sm font-semibold mb-3 flex items-center gap-2">
						<Terminal class="size-4 text-primary" />
						Global Servers
					</h3>
					<div
						v-if="conversation.globalMcpServers.length === 0"
						class="text-sm text-muted-foreground italic pl-6"
					>
						No global servers configured.
					</div>
					<div v-else class="space-y-2">
						<div
							v-for="server in conversation.globalMcpServers"
							:key="`global-${server.name}`"
							class="p-3 rounded-lg border bg-muted/30 cursor-pointer hover:border-primary/50 transition-colors"
							@click="handleToggleServer(server)"
						>
							<div class="flex items-center justify-between">
								<div class="flex items-center gap-2">
									<component
										:is="isServerExpanded(server) ? ChevronDown : ChevronRight"
										class="size-3.5 text-muted-foreground"
									/>
									<span class="font-medium text-sm">{{ server.name }}</span>
								</div>
								<Badge variant="outline" class="text-xs">
									{{ server.config.url ? server.config.type || "HTTP" : "stdio" }}
								</Badge>
							</div>
							<p class="text-xs text-muted-foreground mt-1 font-mono truncate pl-5">
								{{ getMcpConnectionInfo(server) }}
							</p>

							<!-- Tools List -->
							<Transition name="accordion">
								<div
									v-if="isServerExpanded(server)"
									class="mt-3 space-y-2 py-1"
									@click.stop
								>
									<div v-if="conversation.isLoadingMcpTools" class="flex items-center gap-2 py-2">
										<Loader2 class="size-3 animate-spin text-muted-foreground" />
										<span class="text-xs text-muted-foreground">Loading tools...</span>
									</div>
									<div v-else-if="conversation.mcpToolsError" class="text-xs text-red-500 py-2">
										{{ conversation.mcpToolsError }}
									</div>
									<div
										v-else-if="conversation.mcpServerTools.length === 0"
										class="text-xs text-muted-foreground py-2 italic"
									>
										No tools found.
									</div>
									<div v-else class="grid gap-2">
										<div
											v-for="tool in conversation.mcpServerTools"
											:key="tool.name"
											class="group/tool bg-muted/20 rounded p-2 border border-transparent hover:border-border transition-colors"
										>
											<div class="flex items-center justify-between gap-2 overflow-hidden">
												<span
													class="text-xs font-mono font-bold text-primary truncate"
													:title="tool.name"
													>{{ tool.name }}</span
												>
											</div>
											<p
												v-if="tool.description"
												class="text-[10px] text-muted-foreground mt-1 line-clamp-2"
											>
												{{ tool.description }}
											</p>
										</div>
									</div>
								</div>
							</Transition>
						</div>
					</div>
				</div>
			</template>

			<!-- Future Feature Note -->
			<div
				class="p-3 rounded-lg border border-dashed bg-muted/20 text-xs text-muted-foreground"
			>
				<strong>Coming Soon:</strong> Enable/disable MCP servers per conversation.
			</div>
		</div>
	</ScrollArea>
</template>

<style scoped>
.accordion-enter-active,
.accordion-leave-active {
	transition: all 0.3s ease-in-out;
	max-height: 1000px;
	overflow: hidden;
}

.accordion-enter-from,
.accordion-leave-to {
	max-height: 0;
	opacity: 0;
	padding-top: 0;
	padding-bottom: 0;
	margin-top: 0;
	border: none;
}
</style>
