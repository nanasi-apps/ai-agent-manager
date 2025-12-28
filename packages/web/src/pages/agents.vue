<script setup lang="ts">
import { onMounted, onUnmounted, reactive, ref } from 'vue'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Loader2, RefreshCcw, Send } from 'lucide-vue-next'
import { orpc } from '@/services/orpc'

interface AgentStatus {
  sessionId: string
  isRunning: boolean
  lastSeenAt?: number
}

interface OrchestrationTask {
  id: string
  sessionId: string
  message: string
  status: string
  createdAt: number
  updatedAt: number
  error?: string
}

const agentStatuses = ref<AgentStatus[]>([])
const tasks = ref<OrchestrationTask[]>([])
const isLoading = ref(false)
const isDispatching = ref(false)
const isBroadcasting = ref(false)
const dispatchError = ref('')
const broadcastError = ref('')
const refreshIntervalMs = 5000
let refreshTimer: number | undefined

const dispatchForm = reactive({
  sessionId: '',
  message: '',
  command: '',
  agentType: ''
})

const broadcastMessage = ref('')

const loadDashboard = async () => {
  isLoading.value = true
  try {
    const [statusList, taskList] = await Promise.all([
      orpc.getAgentStatuses(),
      orpc.listOrchestrationTasks()
    ])
    agentStatuses.value = statusList
    tasks.value = taskList
  } catch (e) {
    console.error(e)
  } finally {
    isLoading.value = false
  }
}

const dispatchTask = async () => {
  dispatchError.value = ''
  if (!dispatchForm.sessionId || !dispatchForm.message) {
    dispatchError.value = 'Session ID and message are required.'
    return
  }
  isDispatching.value = true
  try {
    const result = await orpc.dispatchOrchestrationTask({
      sessionId: dispatchForm.sessionId,
      message: dispatchForm.message,
      command: dispatchForm.command || undefined,
      agentType: dispatchForm.agentType || undefined
    })
    if (!result.success) {
      dispatchError.value = result.error || 'Dispatch failed.'
    } else {
      dispatchForm.message = ''
      await loadDashboard()
    }
  } catch (e) {
    dispatchError.value = String(e)
  } finally {
    isDispatching.value = false
  }
}

const broadcastContext = async () => {
  broadcastError.value = ''
  if (!broadcastMessage.value.trim()) {
    broadcastError.value = 'Broadcast message is required.'
    return
  }
  isBroadcasting.value = true
  try {
    const result = await orpc.broadcastContext({
      message: broadcastMessage.value
    })
    if (!result.success) {
      broadcastError.value = 'Broadcast completed with failures.'
    }
    broadcastMessage.value = ''
    await loadDashboard()
  } catch (e) {
    broadcastError.value = String(e)
  } finally {
    isBroadcasting.value = false
  }
}

const formatTimestamp = (value?: number) => {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleTimeString()
}

const taskVariant = (status: string) => {
  if (status === 'failed') return 'destructive'
  if (status === 'sent') return 'secondary'
  return 'outline'
}

onMounted(() => {
  loadDashboard()
  refreshTimer = window.setInterval(loadDashboard, refreshIntervalMs)
})

onUnmounted(() => {
  if (refreshTimer) {
    window.clearInterval(refreshTimer)
  }
})
</script>

<template>
  <div class="p-6 space-y-6">
    <div class="flex items-center justify-between">
      <div>
        <h1 class="text-2xl font-bold">Agent Manager Viewer</h1>
        <p class="text-sm text-muted-foreground">
          Monitor and control active agents.
        </p>
      </div>
      <Button variant="outline" :disabled="isLoading" @click="loadDashboard">
        <RefreshCcw class="size-4 mr-2" />
        Refresh
      </Button>
    </div>

    <div class="grid gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Dispatch Task</CardTitle>
        </CardHeader>
        <CardContent class="space-y-4">
          <div class="space-y-2">
            <label class="text-sm font-medium">Session ID</label>
            <Input v-model="dispatchForm.sessionId" placeholder="session-123" />
          </div>
          <div class="space-y-2">
            <label class="text-sm font-medium">Agent Type (optional)</label>
            <Input v-model="dispatchForm.agentType" placeholder="gemini / claude / codex / custom" />
          </div>
          <div class="space-y-2">
            <label class="text-sm font-medium">Command (optional)</label>
            <Input v-model="dispatchForm.command" placeholder="codex exec --json --full-auto" />
          </div>
          <div class="space-y-2">
            <label class="text-sm font-medium">Task Message</label>
            <Textarea v-model="dispatchForm.message" rows="4" placeholder="Summarize the latest diff." />
          </div>
          <div v-if="dispatchError" class="text-sm text-destructive">{{ dispatchError }}</div>
          <Button :disabled="isDispatching" @click="dispatchTask">
            <Loader2 v-if="isDispatching" class="size-4 mr-2 animate-spin" />
            <Send v-else class="size-4 mr-2" />
            Dispatch
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Broadcast Context</CardTitle>
        </CardHeader>
        <CardContent class="space-y-4">
          <div class="space-y-2">
            <label class="text-sm font-medium">Message</label>
            <Textarea v-model="broadcastMessage" rows="6" placeholder="Global context for all active agents." />
          </div>
          <div v-if="broadcastError" class="text-sm text-destructive">{{ broadcastError }}</div>
          <Button :disabled="isBroadcasting" variant="secondary" @click="broadcastContext">
            <Loader2 v-if="isBroadcasting" class="size-4 mr-2 animate-spin" />
            Broadcast
          </Button>
        </CardContent>
      </Card>
    </div>

    <div class="grid gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Agent Status</CardTitle>
        </CardHeader>
        <CardContent>
          <div v-if="isLoading" class="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 class="size-4 animate-spin" />
            Loading status...
          </div>
          <div v-else-if="agentStatuses.length === 0" class="text-sm text-muted-foreground">
            No active sessions.
          </div>
          <div v-else class="space-y-3">
            <div
              v-for="agent in agentStatuses"
              :key="agent.sessionId"
              class="flex items-center justify-between rounded-md border px-3 py-2"
            >
              <div>
                <div class="text-sm font-medium">{{ agent.sessionId }}</div>
                <div class="text-xs text-muted-foreground">Last seen: {{ formatTimestamp(agent.lastSeenAt) }}</div>
              </div>
              <Badge :variant="agent.isRunning ? 'secondary' : 'outline'">
                {{ agent.isRunning ? 'Running' : 'Stopped' }}
              </Badge>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Recent Tasks</CardTitle>
        </CardHeader>
        <CardContent>
          <div v-if="isLoading" class="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 class="size-4 animate-spin" />
            Loading tasks...
          </div>
          <div v-else-if="tasks.length === 0" class="text-sm text-muted-foreground">
            No tasks dispatched yet.
          </div>
          <ScrollArea v-else class="h-80 pr-2">
            <div class="space-y-3">
              <div v-for="task in tasks" :key="task.id" class="rounded-md border p-3 space-y-2">
                <div class="flex items-center justify-between">
                  <div class="text-sm font-medium truncate">{{ task.sessionId }}</div>
                  <Badge :variant="taskVariant(task.status)">{{ task.status }}</Badge>
                </div>
                <div class="text-xs text-muted-foreground">{{ task.message }}</div>
                <div v-if="task.error" class="text-xs text-destructive">{{ task.error }}</div>
              </div>
            </div>
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  </div>
</template>
