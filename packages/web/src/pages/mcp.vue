<script setup lang="ts">
import type { McpServerEntry } from "@agent-manager/shared";
import {
	AlertCircle,
	CheckCircle,
	ExternalLink,
	Loader2,
	Plug,
	RefreshCw,
	Server,
	Terminal,
} from "lucide-vue-next";
import { computed, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { orpcQuery } from "@/services/orpc";

const { t } = useI18n();

interface McpServersBySource {
	gemini: McpServerEntry[];
	claudeDesktop: McpServerEntry[];
	claudeCode: McpServerEntry[];
}

const servers = ref<McpServersBySource>({
	gemini: [],
	claudeDesktop: [],
	claudeCode: [],
});
const isLoading = ref(false);
const activeFilter = ref<"all" | "gemini" | "claude-desktop" | "claude-code">(
	"all",
);

const loadServers = async () => {
	isLoading.value = true;
	try {
		const result = await orpcQuery.getMcpServersBySource.call();
		servers.value = result;
	} catch (e) {
		console.error("Failed to load MCP servers:", e);
	} finally {
		isLoading.value = false;
	}
};

const allServers = computed(() => [
	...servers.value.gemini,
	...servers.value.claudeDesktop,
	...servers.value.claudeCode,
]);

const filteredServers = computed(() => {
	switch (activeFilter.value) {
		case "gemini":
			return servers.value.gemini;
		case "claude-desktop":
			return servers.value.claudeDesktop;
		case "claude-code":
			return servers.value.claudeCode;
		default:
			return allServers.value;
	}
});

const getSourceLabel = (source: McpServerEntry["source"]) => {
	switch (source) {
		case "gemini":
			return "Gemini CLI";
		case "claude-desktop":
			return "Claude Desktop";
		case "claude-code":
			return "Claude Code";
		default:
			return source;
	}
};

const getSourceVariant = (
	source: McpServerEntry["source"],
): "default" | "secondary" | "outline" => {
	switch (source) {
		case "gemini":
			return "default";
		case "claude-desktop":
			return "secondary";
		case "claude-code":
			return "outline";
		default:
			return "outline";
	}
};

const getConnectionType = (entry: McpServerEntry) => {
	if (entry.config.url) {
		return entry.config.type || "HTTP";
	}
	if (entry.config.command) {
		return "stdio";
	}
	return "unknown";
};

const getConnectionInfo = (entry: McpServerEntry) => {
	if (entry.config.url) {
		return entry.config.url;
	}
	if (entry.config.command) {
		const args = entry.config.args?.join(" ") || "";
		return `${entry.config.command} ${args}`.trim();
	}
	return "—";
};

const setFilter = (filter: typeof activeFilter.value) => {
	activeFilter.value = filter;
};

onMounted(() => {
	loadServers();
});
</script>

<template>
	<div class="h-full p-6">
		<div class="flex items-center justify-between mb-6">
			<div>
				<h1 class="text-2xl font-bold flex items-center gap-2">
					<Plug class="size-6"/>
					{{ t('mcp.title') }}
				</h1>
				<p class="text-muted-foreground mt-1">{{ t('mcp.description') }}</p>
			</div>
			<Button
				variant="outline"
				size="sm"
				@click="loadServers"
				:disabled="isLoading"
			>
				<RefreshCw class="size-4 mr-2" :class="{ 'animate-spin': isLoading }"/>
				{{ t('mcp.refresh') }}
			</Button>
		</div>

		<!-- Loading State -->
		<div v-if="isLoading" class="flex items-center justify-center py-20">
			<Loader2 class="size-8 animate-spin text-muted-foreground"/>
		</div>

		<!-- Content -->
		<div v-else>
			<!-- Stats Cards -->
			<div class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
				<Card
					class="cursor-pointer transition-all hover:border-primary/50"
					:class="{ 'border-primary ring-1 ring-primary/20': activeFilter === 'gemini' }"
					@click="setFilter('gemini')"
				>
					<CardHeader class="pb-2">
						<CardDescription class="flex items-center gap-2">
							<Terminal class="size-4"/>
							Gemini CLI
						</CardDescription>
						<CardTitle class="text-2xl">{{ servers.gemini.length }}</CardTitle>
					</CardHeader>
					<CardContent>
						<p class="text-xs text-muted-foreground font-mono">
							~/.gemini/settings.json
						</p>
					</CardContent>
				</Card>
				<Card
					class="cursor-pointer transition-all hover:border-primary/50"
					:class="{ 'border-primary ring-1 ring-primary/20': activeFilter === 'claude-desktop' }"
					@click="setFilter('claude-desktop')"
				>
					<CardHeader class="pb-2">
						<CardDescription class="flex items-center gap-2">
							<ExternalLink class="size-4"/>
							Claude Desktop
						</CardDescription>
						<CardTitle class="text-2xl">
							{{ servers.claudeDesktop.length }}
						</CardTitle>
					</CardHeader>
					<CardContent>
						<p class="text-xs text-muted-foreground font-mono truncate">
							~/Library/.../claude_desktop_config.json
						</p>
					</CardContent>
				</Card>
				<Card
					class="cursor-pointer transition-all hover:border-primary/50"
					:class="{ 'border-primary ring-1 ring-primary/20': activeFilter === 'claude-code' }"
					@click="setFilter('claude-code')"
				>
					<CardHeader class="pb-2">
						<CardDescription class="flex items-center gap-2">
							<Terminal class="size-4"/>
							Claude Code
						</CardDescription>
						<CardTitle class="text-2xl">
							{{ servers.claudeCode.length }}
						</CardTitle>
					</CardHeader>
					<CardContent>
						<p class="text-xs text-muted-foreground font-mono">
							~/.claude/settings.json
						</p>
					</CardContent>
				</Card>
			</div>

			<!-- Filter Pills -->
			<div class="flex items-center gap-2 mb-4">
				<Button
					size="sm"
					:variant="activeFilter === 'all' ? 'default' : 'outline'"
					@click="setFilter('all')"
				>
					All ({{ allServers.length }})
				</Button>
				<Button
					size="sm"
					:variant="activeFilter === 'gemini' ? 'default' : 'outline'"
					@click="setFilter('gemini')"
				>
					Gemini ({{ servers.gemini.length }})
				</Button>
				<Button
					size="sm"
					:variant="activeFilter === 'claude-desktop' ? 'default' : 'outline'"
					@click="setFilter('claude-desktop')"
				>
					Claude Desktop ({{ servers.claudeDesktop.length }})
				</Button>
				<Button
					size="sm"
					:variant="activeFilter === 'claude-code' ? 'default' : 'outline'"
					@click="setFilter('claude-code')"
				>
					Claude Code ({{ servers.claudeCode.length }})
				</Button>
			</div>

			<!-- Server List -->
			<Card>
				<CardHeader>
					<CardTitle class="text-lg">
						{{ activeFilter === 'all' ? t('mcp.allServers') : t('mcp.sourceServers', { source: getSourceLabel(activeFilter as McpServerEntry['source']) }) }}
					</CardTitle>
					<CardDescription>
						{{ activeFilter === 'all' ? t('mcp.allServersDesc') : t('mcp.sourceServersDesc', { source: getSourceLabel(activeFilter as McpServerEntry['source']) }) }}
					</CardDescription>
				</CardHeader>
				<CardContent>
					<div
						v-if="filteredServers.length === 0"
						class="text-center py-12 text-muted-foreground"
					>
						<Server class="size-12 mx-auto mb-4 opacity-20"/>
						<p v-if="activeFilter === 'all'">{{ t('mcp.noServers') }}</p>
						<p v-else>
							{{ t('mcp.noServersIn', { source: getSourceLabel(activeFilter as McpServerEntry['source']) }) }}
						</p>
						<p class="text-sm mt-2">{{ t('mcp.configureHint') }}</p>
					</div>
					<ScrollArea v-else class="max-h-[500px]">
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead class="w-[180px]">
										{{ t('mcp.table.name') }}
									</TableHead>
									<TableHead class="w-[120px]">
										{{ t('mcp.table.source') }}
									</TableHead>
									<TableHead class="w-[80px]">
										{{ t('mcp.table.type') }}
									</TableHead>
									<TableHead>{{ t('mcp.table.connection') }}</TableHead>
									<TableHead class="w-[100px]">
										{{ t('mcp.table.status') }}
									</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								<TableRow
									v-for="server in filteredServers"
									:key="`${server.source}-${server.name}`"
								>
									<TableCell class="font-medium">
										<div class="flex items-center gap-2">
											<Server class="size-4 text-muted-foreground"/>
											{{ server.name }}
										</div>
									</TableCell>
									<TableCell>
										<Badge :variant="getSourceVariant(server.source)">
											{{ getSourceLabel(server.source) }}
										</Badge>
									</TableCell>
									<TableCell>
										<code class="text-xs bg-muted px-1.5 py-0.5 rounded">
											{{ getConnectionType(server) }}
										</code>
									</TableCell>
									<TableCell class="font-mono text-xs max-w-[300px] truncate">
										{{ getConnectionInfo(server) }}
									</TableCell>
									<TableCell>
										<div class="flex items-center gap-1.5">
											<CheckCircle
												v-if="server.enabled"
												class="size-4 text-green-500"
											/>
											<AlertCircle v-else class="size-4 text-yellow-500"/>
											<span class="text-xs"
												>{{ server.enabled ? t('general.enabled') : t('general.disabled') }}</span
											>
										</div>
									</TableCell>
								</TableRow>
							</TableBody>
						</Table>
					</ScrollArea>
				</CardContent>
			</Card>

			<!-- Future Features Note -->
			<div class="mt-6 p-4 rounded-lg border border-dashed bg-muted/30">
				<p class="text-sm text-muted-foreground">
					<strong>{{ t('mcp.comingSoon') }}</strong>
				</p>
			</div>
		</div>
	</div>
</template>
