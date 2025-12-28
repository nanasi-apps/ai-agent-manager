<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { orpc } from '@/services/orpc'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Loader2, Plus, Trash2, FileText, Save } from 'lucide-vue-next'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

interface GlobalRule {
  id: string
  name: string
  content?: string
}

const rules = ref<GlobalRule[]>([])
const selectedRule = ref<GlobalRule | null>(null)
const ruleContent = ref('') // Content of selected rule
const isLoading = ref(false)
const isSaving = ref(false)

// New rule dialog
const isNewRuleOpen = ref(false)
const newRuleName = ref('')
const isCreating = ref(false)

const loadRules = async () => {
    isLoading.value = true
    try {
        const res = await orpc.listGlobalRules()
        rules.value = res
        // If we have a selected rule, refresh its content too if sticking to it? 
        // Or if nothing selected, select first?
        const first = rules.value[0]
        if (!selectedRule.value && first) {
            await selectRule(first)
        }
    } catch (e) {
        console.error(e)
    } finally {
        isLoading.value = false
    }
}

const selectRule = async (rule: GlobalRule) => {
    selectedRule.value = rule
    isLoading.value = true
    try {
        const details = await orpc.getGlobalRule({ id: rule.id })
        if (details) {
            ruleContent.value = details.content
        }
    } catch (e) {
        console.error(e)
        ruleContent.value = ''
    } finally {
        isLoading.value = false
    }
}

const saveCurrentRule = async () => {
    if (!selectedRule.value) return
    isSaving.value = true
    try {
        await orpc.updateGlobalRule({
            id: selectedRule.value.id,
            content: ruleContent.value
        })
    } catch (e) {
        console.error(e)
    } finally {
        isSaving.value = false
    }
}

const createRule = async () => {
    if (!newRuleName.value.trim()) return
    isCreating.value = true
    try {
        const res = await orpc.createGlobalRule({
            name: newRuleName.value,
            content: ''
        })
        if (res.success) {
            isNewRuleOpen.value = false
            newRuleName.value = ''
            await loadRules()
            // Select the newly created rule
            const newRule = rules.value.find(r => r.id === res.id)
            if (newRule) {
                 // selectRule expects a rule object
                 await selectRule(newRule as GlobalRule)
            }
        }
    } catch (e) {
        console.error(e)
    } finally {
        isCreating.value = false
    }
}

const deleteRule = async (id: string) => {
    if (!confirm('Are you sure you want to delete this rule?')) return
    try {
        await orpc.deleteGlobalRule({ id })
        await loadRules()
        if (selectedRule.value?.id === id) {
            selectedRule.value = null
            ruleContent.value = ''
            if (rules.value.length > 0) {
                // Ensure array element exists
                await selectRule(rules.value[0] as GlobalRule)
            }
        }
    } catch (e) {
        console.error(e)
    }
}

const openNewRuleDialog = () => {
    newRuleName.value = ''
    isNewRuleOpen.value = true
}

onMounted(() => {
    loadRules()
})
</script>

<template>
  <div class="h-full flex p-6 gap-6">
    <!-- Left Sidebar: List of Rules -->
    <div class="w-64 flex flex-col border-r pr-6">
       <div class="flex items-center justify-between mb-4">
           <h2 class="text-xl font-bold">Global Rules</h2>
           <Button size="icon" variant="ghost" @click="openNewRuleDialog">
               <Plus class="size-4" />
           </Button>
       </div>
       
       <ScrollArea class="flex-1">
           <div class="space-y-1">
               <Button
                 v-for="rule in rules"
                 :key="rule.id"
                 variant="ghost"
                 :class="['w-full justify-start text-left', selectedRule?.id === rule.id ? 'bg-secondary' : '']"
                 @click="selectRule(rule)"
               >
                 <FileText class="size-4 mr-2 text-muted-foreground" />
                 <span class="truncate flex-1">{{ rule.name }}</span>
                 <Trash2 
                   class="size-4 text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity" 
                   @click.stop="deleteRule(rule.id)"
                 />
               </Button>
               <div v-if="rules.length === 0 && !isLoading" class="text-sm text-muted-foreground text-center py-4">
                   No rules found.
               </div>
           </div>
       </ScrollArea>
    </div>

    <!-- Main Content: Editor -->
    <div class="flex-1 flex flex-col h-full">
        <div v-if="selectedRule" class="flex flex-col h-full">
            <div class="flex items-center justify-between mb-4">
                <div>
                   <h1 class="text-lg font-semibold">{{ selectedRule.name }}</h1>
                   <p class="text-xs text-muted-foreground">ID: {{ selectedRule.id }}</p>
                </div>
                <Button :disabled="isSaving" @click="saveCurrentRule">
                    <Loader2 v-if="isSaving" class="w-4 h-4 mr-2 animate-spin" />
                    <Save class="w-4 h-4 mr-2" v-else />
                    Save Rule
                </Button>
            </div>
            
            <div class="flex-1 border rounded-lg p-0 overflow-hidden bg-card">
                 <Textarea 
                   v-model="ruleContent" 
                   class="w-full h-full p-4 font-mono text-sm resize-none border-0 focus-visible:ring-0" 
                   placeholder="Write your rule in Markdown..."
                 />
            </div>
        </div>
        
        <div v-else class="flex-1 flex items-center justify-center text-muted-foreground">
            <div class="text-center">
                <FileText class="size-12 mx-auto mb-2 opacity-20" />
                <p>Select a rule to edit</p>
            </div>
        </div>
    </div>

    <!-- New Rule Dialog -->
    <Dialog :open="isNewRuleOpen" @update:open="isNewRuleOpen = $event">
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create Global Rule</DialogTitle>
          <DialogDescription>
            Enter a name for the new rule (e.g., "Coding Standards", "Git Workflow").
          </DialogDescription>
        </DialogHeader>
        <div class="py-4">
           <Input v-model="newRuleName" placeholder="Rule Name" @keydown.enter="createRule" />
        </div>
        <DialogFooter>
          <Button variant="outline" @click="isNewRuleOpen = false">Cancel</Button>
          <Button :disabled="!newRuleName.trim() || isCreating" @click="createRule">
             <Loader2 v-if="isCreating" class="size-4 animate-spin mr-2" />
             Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>
</template>
