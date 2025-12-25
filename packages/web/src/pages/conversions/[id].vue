<script setup lang="ts">
import { ref, onMounted, nextTick, watch } from 'vue'
import { useRoute } from 'vue-router'
import { orpc } from '@/services/orpc'
import { useMarkdown } from '@/composables/useMarkdown'
import { 
  Send, 
  Loader2, 
  AlertCircle, 
  Sparkles, 
  Copy, 
  Check, 
  Square, 
  ChevronRight, 
  ChevronDown,
  Terminal
} from 'lucide-vue-next'
import { Avatar } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { ScrollArea } from '@/components/ui/scroll-area'
import type { AgentLogPayload } from '@/types/electron'

type LogType = 'text' | 'tool_call' | 'tool_result' | 'thinking' | 'error' | 'system'

interface Message {
  id: string
  role: 'user' | 'agent' | 'system'
  content: string
  timestamp: number
  logType?: LogType
}

const route = useRoute()
const { renderMarkdown } = useMarkdown()
const sessionId = ref((route.params as unknown as { id: string }).id)
const input = ref('')
const messages = ref<Message[]>([])
const isLoading = ref(false)
const isGenerating = ref(false)
const isConnected = ref(false)
const copiedId = ref<string | null>(null)
const expandedMessageIds = ref(new Set<string>())
const modelName = ref<string | null>(null)

const scrollAreaRef = ref<InstanceType<typeof ScrollArea> | null>(null)
const messagesEndRef = ref<HTMLElement | null>(null)

const toggleMessage = (id: string) => {
  if (expandedMessageIds.value.has(id)) {
    expandedMessageIds.value.delete(id)
  } else {
    expandedMessageIds.value.add(id)
  }
}

const scrollToBottom = async (smooth = true) => {
  await nextTick()
  
  // Method 1: Use messagesEndRef if available
  if (messagesEndRef.value) {
    messagesEndRef.value.scrollIntoView({ behavior: smooth ? 'smooth' : 'instant' })
    return
  }
  
  // Method 2: Fallback to viewport scroll
  const el = scrollAreaRef.value?.$el as HTMLElement | undefined
  const viewport = el?.querySelector('[data-radix-scroll-area-viewport]') as HTMLElement || 
                   document.querySelector('[data-radix-scroll-area-viewport]') as HTMLElement
  
  if (viewport) {
    if (smooth) {
      viewport.scrollTo({ top: viewport.scrollHeight, behavior: 'smooth' })
    } else {
      viewport.scrollTop = viewport.scrollHeight
    }
  }
}

const copyMessage = async (content: string, id: string) => {
  try {
    // Strip HTML tags for plain text copy
    const plainText = content.replace(/<[^>]*>/g, '')
    await navigator.clipboard.writeText(plainText)
    copiedId.value = id
    setTimeout(() => copiedId.value = null, 2000)
  } catch (err) {
    console.error('Failed to copy:', err)
  }
}



const appendAgentLog = (payload: AgentLogPayload) => {
  const content = payload.data
  if (!content.trim()) return

  // Extract model name from init event
  if (payload.raw && typeof payload.raw === 'object') {
    const raw = payload.raw as Record<string, unknown>
    if (raw.type === 'init' && typeof raw.model === 'string') {
      modelName.value = raw.model
    }
  }

  // Determine effective type and role for the INCOMING chunk
  const incomingType = payload.type || 'text'
  const incomingRole = incomingType === 'system' ? 'system' : 'agent'
  
  const lastMsg = messages.value[messages.value.length - 1]
  
  // Check if we can merge
  let merged = false
  if (lastMsg) {
    // Determine effective type of the LAST message
    const lastType = lastMsg.logType || 'text'
    
    // Strict role match is required
    if (lastMsg.role === incomingRole) {
      // If both are text, merge
      if (incomingType === 'text' && lastType === 'text') {
        lastMsg.content += content
        merged = true
      }
      // If same non-text type (e.g. streaming tool output), merge
      else if (incomingType !== 'text' && incomingType === lastType) {
        lastMsg.content += content
        merged = true
      }
    }
  }

  if (!merged) {
    // Create new
    messages.value.push({
      id: crypto.randomUUID(),
      role: incomingRole,
      content,
      timestamp: Date.now(),
      logType: incomingType as LogType
    })
  }

  scrollToBottom()
}

const sendMessage = async () => {
  if (!input.value.trim()) return

  const messageText = input.value
  input.value = ''
  isLoading.value = true
  
  // Add user message
  messages.value.push({
    id: crypto.randomUUID(),
    role: 'user',
    content: messageText,
    timestamp: Date.now()
  })
  
  scrollToBottom()

  try {
    await orpc.sendMessage({
      sessionId: sessionId.value,
      message: messageText
    })
    // Agent logs will come via event listener
  } catch (err) {
    console.error('Failed to send message', err)
    messages.value.push({
      id: crypto.randomUUID(),
      role: 'system',
      content: `Failed to send message: ${err}`,
      timestamp: Date.now(),
      logType: 'error',
    })
  } finally {
    isLoading.value = false
  }
}

// Handle CMD+Enter to submit
const handleKeydown = (e: KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        sendMessage()
    }
}

// Watch for route param changes
watch(() => (route.params as { id: string }).id, (newId) => {
  if (newId) {
    sessionId.value = newId
    messages.value = []
    loadConversation(newId)
  }
})

// Load conversation data and saved messages
// Load conversation data and saved messages
async function loadConversation(id: string) {
  try {
    // Load saved messages from store
    const savedMessages = await orpc.getMessages({ sessionId: id })
    if (savedMessages && savedMessages.length > 0) {
      messages.value = savedMessages.map(m => ({
        id: m.id,
        role: m.role,
        content: m.content,
        timestamp: m.timestamp,
        logType: m.logType,
      }))
      // Use instant scroll for initial load
      scrollToBottom(false)
    }
  } catch (err) {
    console.error('Failed to load conversation:', err)
  }
}

const stopGeneration = () => {
  isGenerating.value = false
  isLoading.value = false
}

onMounted(async () => {
  // Load conversation data first to show initial message
  await loadConversation(sessionId.value)

  if (window.electronAPI) {
    isConnected.value = true
    
    const handleLog = (payload: AgentLogPayload) => {
      // Filter by sessionId
      if (payload.sessionId === sessionId.value) {
        appendAgentLog(payload)
      }
    }
    
    window.electronAPI.onAgentLog(handleLog)
  } else {
    isConnected.value = false
    messages.value.push({
      id: crypto.randomUUID(),
      role: 'system',
      content: 'Not in Electron environment. Agent logs will not appear.',
      timestamp: Date.now(),
      logType: 'system',
    })
  }
})

const formatTime = (timestamp: number) => {
  return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}
</script>

<template>
  <div class="flex flex-col h-full overflow-hidden bg-background">
    <!-- Header -->
    <div class="border-b px-6 py-3 flex items-center justify-between bg-card/80 backdrop-blur-xl sticky top-0 z-10 shrink-0">
      <div class="flex items-center gap-3">
        <div class="size-9 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center shadow-lg shadow-violet-500/20">
          <Sparkles class="size-5 text-white" />
        </div>
        <div>
          <h1 class="text-base font-semibold">Chat Session</h1>
          <p class="text-[10px] text-muted-foreground font-mono truncate max-w-[200px]">{{ sessionId }}</p>
          <h2 class="font-semibold text-sm">{{ modelName || 'Agent Session' }}</h2>
          <div class="flex items-center gap-1.5">
            <span class="size-1.5 rounded-full" :class="isConnected ? 'bg-green-500' : 'bg-red-500'" />
            <span class="text-xs text-muted-foreground">{{ isConnected ? 'Connected' : 'Disconnected' }}</span>
          </div>
        </div>
      </div>
    </div>

    <!-- Messages Area -->
    <ScrollArea class="flex-1 min-h-0" ref="scrollAreaRef">
      <div class="flex flex-col gap-2 p-4 max-w-3xl mx-auto">
        <div v-if="messages.length === 0" class="flex flex-col items-center justify-center py-20 text-center">
          <div class="size-12 rounded-full bg-muted flex items-center justify-center mb-4">
            <Sparkles class="size-6 text-muted-foreground" />
          </div>
          <h3 class="font-semibold text-lg mb-2">Start a conversation</h3>
          <p class="text-sm text-muted-foreground max-w-sm">
            Send a message to start working with your agent.
          </p>
        </div>

        <div v-for="msg in messages" :key="msg.id">
          <!-- Type 1: Standard Chat Balloon (User or Agent 'text') -->
          <div 
            v-if="msg.role === 'user' || (msg.role === 'agent' && (!msg.logType || msg.logType === 'text'))"
            class="group flex gap-4 my-4" 
            :class="{ 'flex-row-reverse': msg.role === 'user' }"
          >
            <!-- Avatar -->
            <Avatar class="size-8 shrink-0 border" :class="msg.role === 'agent' ? 'bg-primary/10' : 'bg-muted'">
              <div v-if="msg.role === 'agent'" class="flex items-center justify-center size-full text-primary font-semibold text-xs">AI</div>
              <div v-else class="flex items-center justify-center size-full text-muted-foreground font-semibold text-xs">You</div>
            </Avatar>

            <!-- Message Content -->
            <div class="flex flex-col gap-1 min-w-0 max-w-[85%]" :class="{ 'items-end': msg.role === 'user' }">
              <div class="flex items-center gap-2 px-1">
                <span class="text-xs font-medium text-muted-foreground">
                  {{ msg.role === 'agent' ? 'Agent' : 'You' }}
                </span>
                <span class="text-[10px] text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity">
                  {{ formatTime(msg.timestamp) }}
                </span>
              </div>
              <div 
                class="relative bg-card border rounded-2xl px-4 py-3 shadow-sm markdown-content"
                :class="{
                  'rounded-tr-md': msg.role === 'user',
                  'rounded-tl-md': msg.role === 'agent',
                }"
              >
                <div v-html="renderMarkdown(msg.content)" />
                
                <!-- Copy Button -->
                <button 
                  @click.stop="copyMessage(msg.content, msg.id)"
                  class="absolute top-2 right-2 size-7 rounded-lg bg-background/80 border opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center hover:bg-muted"
                >
                  <Check v-if="copiedId === msg.id" class="size-3.5 text-green-500" />
                  <Copy v-else class="size-3.5 text-muted-foreground" />
                </button>
              </div>
            </div>
          </div>

          <!-- Type 2: System / Tool / Thinking Log (Minimal Timeline Style) -->
          <div v-else class="flex flex-col gap-0.5 py-0.5 px-4 group">
             <!-- Collapsible Header -->
            <div 
              @click="toggleMessage(msg.id)"
              class="flex items-center gap-2 cursor-pointer select-none px-2 py-1.5 rounded-md hover:bg-black/5 dark:hover:bg-white/5 transition-colors opacity-80 hover:opacity-100"
            >
              <component 
                :is="expandedMessageIds.has(msg.id) ? ChevronDown : ChevronRight" 
                class="size-3.5 opacity-50 shrink-0"
              />
              
              <!-- Icon based on type -->
              <Terminal v-if="msg.logType === 'tool_call' || msg.logType === 'tool_result'" class="size-3.5 text-blue-500 shrink-0" />
              <AlertCircle v-else-if="msg.logType === 'error'" class="size-3.5 text-red-500 shrink-0" />
              <Sparkles v-else-if="msg.logType === 'thinking'" class="size-3.5 text-purple-500 shrink-0" />
              <AlertCircle v-else class="size-3.5 text-yellow-500 shrink-0" />

              <span class="text-xs font-medium font-mono uppercase text-muted-foreground">
                {{ msg.logType?.replace('_', ' ') }}
              </span>
              
              <!-- Preview of content if collapsed -->
              <span v-if="!expandedMessageIds.has(msg.id)" class="text-xs text-muted-foreground/60 truncate flex-1 font-mono">
                 - {{ msg.content.slice(0, 60).replace(/\n/g, ' ') }}
              </span>
              
               <!-- Timestamp (faint) -->
               <span class="ml-auto text-[10px] text-muted-foreground/40">{{ formatTime(msg.timestamp) }}</span>
            </div>

            <!-- Expanded Content -->
            <div 
              v-show="expandedMessageIds.has(msg.id)"
              class="pl-8 pr-2 pb-2"
            >
              <div class="relative bg-muted/30 border rounded-md px-3 py-2 text-xs font-mono whitespace-pre-wrap break-words overflow-x-auto text-muted-foreground">
                {{ msg.content }}
                
                 <!-- Copy Button (Small) -->
                <button 
                  @click.stop="copyMessage(msg.content, msg.id)"
                  class="absolute top-2 right-2 size-6 rounded bg-background/50 border opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center hover:bg-background"
                >
                  <Check v-if="copiedId === msg.id" class="size-3 text-green-500" />
                  <Copy v-else class="size-3 text-muted-foreground" />
                </button>
              </div>
            </div>
          </div>
        </div>

        <!-- Typing Indicator (shown when waiting for response) -->
        <div v-if="isGenerating" class="flex gap-4">
          <Avatar class="size-8 shrink-0 border bg-primary/10">
            <div class="flex items-center justify-center size-full text-primary font-semibold text-xs">AI</div>
          </Avatar>
          <div class="bg-card border rounded-2xl rounded-tl-md px-4 py-3 shadow-sm">
            <div class="flex items-center gap-1">
              <span class="size-2 bg-muted-foreground/40 rounded-full animate-bounce" style="animation-delay: 0ms" />
              <span class="size-2 bg-muted-foreground/40 rounded-full animate-bounce" style="animation-delay: 150ms" />
              <span class="size-2 bg-muted-foreground/40 rounded-full animate-bounce" style="animation-delay: 300ms" />
            </div>
          </div>
        </div>

        <!-- Scroll target -->
        <div ref="messagesEndRef" class="h-px" />
      </div>
    </ScrollArea>
    
    <!-- Input Area -->
    <div class="border-t bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 shrink-0">
      <div class="max-w-3xl mx-auto p-4">
        <form @submit.prevent="sendMessage">
          <div class="flex items-end gap-2">
            <div class="flex-1 bg-card rounded-2xl border shadow-sm focus-within:ring-2 focus-within:ring-ring focus-within:border-transparent transition-all">
              <Textarea 
                v-model="input" 
                placeholder="Send a message..." 
                class="min-h-[56px] max-h-[200px] py-3 px-4 bg-transparent border-0 focus-visible:ring-0 resize-none shadow-none text-sm"
                :disabled="isLoading"
                @keydown="handleKeydown"
                autofocus
              />
            </div>
            
            <!-- Stop Button (shown when generating) -->
            <Button 
              v-if="isGenerating"
              type="button"
              size="icon"
              @click="stopGeneration"
              class="h-11 w-11 shrink-0 rounded-xl bg-red-600 hover:bg-red-700 shadow-lg shadow-red-600/20 transition-all text-white border-0"
            >
              <Square class="size-5 fill-current" />
            </Button>
            
            <!-- Send Button (shown when not generating) -->
            <Button 
              v-else
              type="submit" 
              size="icon"
              class="h-11 w-11 shrink-0 rounded-xl bg-blue-600 hover:bg-blue-700 shadow-lg shadow-blue-600/20 transition-all text-white border-0"
              :class="{ 'opacity-50 cursor-not-allowed': !input.trim() || isLoading }"
              :disabled="!input.trim() || isLoading"
            >
              <Loader2 v-if="isLoading" class="size-5 animate-spin" />
              <Send v-else class="size-5" />
            </Button>
          </div>
          <p class="text-center text-[10px] text-muted-foreground mt-2">
            Press <kbd class="px-1 py-0.5 rounded bg-muted text-[9px] font-mono">⌘</kbd> + <kbd class="px-1 py-0.5 rounded bg-muted text-[9px] font-mono">Enter</kbd> to send
          </p>
        </form>
      </div>
    </div>
  </div>
</template>
