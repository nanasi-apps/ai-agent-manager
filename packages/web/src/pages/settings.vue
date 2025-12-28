<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { orpc } from '@/services/orpc';
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

const servers = ref<{ name: string; command: string; args: string[] }[]>([]);
const tools = ref<{ name: string; serverName: string; description?: string }[]>([]);
const loading = ref(false);

async function loadData() {
  loading.value = true;
  try {
    servers.value = await orpc.listMcpServers();
    tools.value = await orpc.listMcpTools();
  } catch (err) {
    console.error("Failed to load MCP data", err);
  } finally {
    loading.value = false;
  }
}

onMounted(() => {
  loadData();
});
</script>

<template>
  <div class="p-4 space-y-6">
    <div>
      <h1 class="text-2xl font-bold mb-2">Settings</h1>
      <p class="text-muted-foreground">Configure your application settings.</p>
    </div>

    <div class="space-y-4">
      <div class="flex items-center justify-between">
        <h2 class="text-xl font-semibold">MCP Servers</h2>
        <Button variant="outline" size="sm" @click="loadData" :disabled="loading">
          Refresh
        </Button>
      </div>

      <div v-if="servers.length === 0" class="text-muted-foreground italic">
        No MCP servers connected. Check mcp.json in your user data directory or project root.
      </div>

      <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card v-for="server in servers" :key="server.name">
          <CardHeader>
            <div class="flex justify-between items-start">
              <CardTitle>{{ server.name }}</CardTitle>
              <Badge variant="outline">Connected</Badge>
            </div>
            <CardDescription class="font-mono text-xs mt-1">
              {{ server.command }} {{ server.args.join(' ') }}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div class="text-sm font-medium mb-2">Tools:</div>
            <div class="flex flex-wrap gap-2">
              <template v-for="tool in tools" :key="tool.name">
                <Badge v-if="tool.serverName === server.name" variant="secondary">
                  {{ tool.name }}
                </Badge>
              </template>
              <div v-if="!tools.some(t => t.serverName === server.name)" class="text-xs text-muted-foreground">
                No tools exposed
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  </div>
</template>
