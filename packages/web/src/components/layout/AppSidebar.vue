<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch } from "vue"
import { useRoute } from "vue-router"
import { Home, Settings, Bot, Inbox, Search, PanelLeft, Plus, Folder, BookOpen } from "lucide-vue-next"
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubItem,
  SidebarMenuSubButton,
  SidebarFooter,
  SidebarGroupLabel,
  SidebarGroupAction,
  SidebarMenuAction,
  useSidebar,
} from "@/components/ui/sidebar"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { orpc } from "@/services/orpc"
import NewProjectDialog from "@/components/dialogs/NewProjectDialog.vue"
import { useNewConversionDialog } from "@/composables/useNewConversionDialog"

// Main navigation items.
const navItems = [
  {
    title: "Dashboard",
    url: "/",
    icon: Home,
  },
  {
    title: "Inbox",
    url: "/inbox",
    icon: Inbox,
  },
  {
    title: "Search",
    url: "#",
    icon: Search,
  },
]

// Projects data
interface ProjectWithConversations {
  id: string;
  name: string;
  conversations: {
    id: string;
    title: string;
  }[];
}

const route = useRoute()
const projects = ref<ProjectWithConversations[]>([]);
const activeItem = ref("Dashboard")
const isProjectDialogOpen = ref(false)

const { open: openNewConversion } = useNewConversionDialog()

const refreshData = async () => {
  try {
    const [fetchedProjects, fetchedConversations] = await Promise.all([
      orpc.listProjects(),
      orpc.listConversations({})
    ]);

    projects.value = fetchedProjects.map((p: { id: string; name: string }) => ({
      id: p.id,
      name: p.name,
      conversations: fetchedConversations
        .filter((c: { projectId: string }) => c.projectId === p.id)
        .map((c: { id: string; title: string }) => ({
          id: c.id,
          title: c.title
        }))
    }));
  } catch (e) {
    console.error("Failed to fetch sidebar data", e);
  }
}

onMounted(() => {
  refreshData()
  window.addEventListener('agent-manager:data-change', refreshData)
});

onUnmounted(() => {
  window.removeEventListener('agent-manager:data-change', refreshData)
});

// Update active item based on route
watch(() => route.path, (path) => {
  if (path === '/') {
    activeItem.value = 'Dashboard'
  } else if (path === '/inbox') {
    activeItem.value = 'Inbox'
  } else if (path.startsWith('/projects/')) {
    const id = path.split('/')[2] || ''
    // We might want to highlight the project name, but for now we don't have a direct "active" state for project headers unless we change the logic.
    // However, let's try to match it if possible, strictly referencing the project ID might not work with current navItems logic unless we add projects to navItems or handle it separately.
    // The current template iterates projects separately.
    // Let's iterate projects and see if we match.
    activeItem.value = id
  } else if (path.startsWith('/conversions/')) {
    const id = path.split('/')[2] || ''
    activeItem.value = id
  } else if (path === '/agents') {
    activeItem.value = 'Agents'
  } else if (path === '/rules') {
    activeItem.value = 'Rules'
  } else if (path === '/settings') {
    activeItem.value = 'Settings'
  }
}, { immediate: true })

// Bottom navigation items.
const bottomItems = [
  {
    title: "Agents",
    url: "/agents",
    icon: Bot,
  },
  {
    title: "Rules",
    url: "/rules",
    icon: BookOpen,
  },
  {
    title: "Settings",
    url: "/settings",
    icon: Settings,
  },
]

const { setSidebarWidth, setOpen, isResizing, state, toggleSidebar } = useSidebar()

function handleItemClick(title: string) {
  activeItem.value = title
}

function handleMouseDown(e: MouseEvent) {
  isResizing.value = true
  
  window.addEventListener("mousemove", handleMouseMove)
  window.addEventListener("mouseup", handleMouseUp)
  e.preventDefault()
}

function handleMouseMove(e: MouseEvent) {
  if (!isResizing.value) return
  
  const newWidth = e.clientX
  
  if (state.value === "collapsed") {
    if (newWidth > 120) {
      setOpen(true)
      setSidebarWidth(`${newWidth}px`)
    }
  } else {
    if (newWidth < 120) {
      setOpen(false)
    } else {
      if (newWidth <= 600) {
        setSidebarWidth(`${newWidth}px`)
      }
    }
  }
}

function handleMouseUp() {
  isResizing.value = false
  window.removeEventListener("mousemove", handleMouseMove)
  window.removeEventListener("mouseup", handleMouseUp)
}
</script>

<template>
  <Sidebar collapsible="icon" class="border-r relative select-none">
    <div 
      class="absolute -right-1 top-0 bottom-0 w-1 cursor-col-resize z-50 transition-colors hover:bg-accent/20"
      @mousedown="handleMouseDown"
    ></div>

    <SidebarContent>
      <SidebarGroup>
        <SidebarGroupContent>
          <SidebarMenu>
            <SidebarMenuItem v-for="item in navItems" :key="item.title">
              <SidebarMenuButton 
                as-child 
                :tooltip="item.title"
                :isActive="activeItem === item.title"
                @click="handleItemClick(item.title)"
                class="transition-all duration-200 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground data-[active=true]:bg-sidebar-accent data-[active=true]:text-sidebar-accent-foreground data-[active=true]:border data-[active=true]:border-sidebar-border data-[active=true]:shadow-sm"
              >
                <router-link :to="item.url" class="flex items-center gap-2 !text-inherit">
                  <component :is="item.icon" class="size-4" />
                  <span class="font-medium">{{ item.title }}</span>
                </router-link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>

      <SidebarGroup class="group-data-[collapsible=icon]:hidden">
        <SidebarGroupLabel>
          Projects
        </SidebarGroupLabel>
        <SidebarGroupAction title="Add Project" @click="isProjectDialogOpen = true">
          <Plus /> <span class="sr-only">Add Project</span>
        </SidebarGroupAction>
        <SidebarGroupContent>
          <SidebarMenu>
             <Collapsible 
               v-for="project in projects" 
               :key="project.id" 
               as-child 
               :default-open="true" 
               class="group/collapsible"
             >
               <SidebarMenuItem>
                 <div class="flex items-center w-full relative">
                   <SidebarMenuButton 
                      as-child 
                      :tooltip="project.name"
                      class="font-medium grow"
                   >
                     <div class="flex items-center gap-2">
                       <CollapsibleTrigger as-child>
                          <Folder class="size-4 shrink-0 cursor-pointer hover:text-foreground/80" />
                       </CollapsibleTrigger>
                       <router-link :to="`/projects/${project.id}`" class="flex-1 truncate">
                          {{ project.name }}
                       </router-link>
                     </div>
                   </SidebarMenuButton>
                   <SidebarMenuAction @click.stop="openNewConversion(project.id)">
                      <Plus /> <span class="sr-only">New Conversion</span>
                   </SidebarMenuAction>
                 </div>

                 <CollapsibleContent>
                   <SidebarMenuSub v-if="project.conversations.length">
                     <SidebarMenuSubItem v-for="conv in project.conversations" :key="conv.id">
                       <SidebarMenuSubButton 
                         as-child 
                         :isActive="activeItem === conv.id"
                         @click="handleItemClick(conv.id)"
                       >
                         <router-link :to="`/conversions/${conv.id}`">
                           <span>{{ conv.title }}</span>
                         </router-link>
                       </SidebarMenuSubButton>
                     </SidebarMenuSubItem>
                   </SidebarMenuSub>
                   <SidebarMenuSub v-else>
                      <SidebarMenuSubItem>
                         <span class="text-xs text-muted-foreground px-2 py-1">No conversations</span>
                      </SidebarMenuSubItem>
                   </SidebarMenuSub>
                 </CollapsibleContent>
               </SidebarMenuItem>
             </Collapsible>
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>

      <SidebarGroup class="mt-auto">
        <SidebarGroupContent>
          <SidebarMenu>
            <SidebarMenuItem v-for="item in bottomItems" :key="item.title">
              <SidebarMenuButton 
                as-child 
                :tooltip="item.title"
                :isActive="activeItem === item.title"
                @click="handleItemClick(item.title)"
                class="transition-all duration-200 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground data-[active=true]:bg-sidebar-accent data-[active=true]:text-sidebar-accent-foreground data-[active=true]:border data-[active=true]:border-sidebar-border data-[active=true]:shadow-sm"
              >
                <router-link :to="item.url" class="flex items-center gap-2 !text-inherit">
                  <component :is="item.icon" class="size-4" />
                  <span class="font-medium">{{ item.title }}</span>
                </router-link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>
    </SidebarContent>
    
    <SidebarFooter class="border-t p-2">
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton 
            @click="toggleSidebar"
            tooltip="サイドバーを閉じる"
            class="w-full justify-start gap-2 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
          >
            <PanelLeft class="size-4" />
            <span class="truncate group-data-[collapsible=icon]:hidden">
              サイドバーを閉じる
            </span>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    </SidebarFooter>
  </Sidebar>
  <NewProjectDialog 
    :open="isProjectDialogOpen" 
    @update:open="isProjectDialogOpen = $event"
    @created="refreshData"
  />
</template>

<style scoped>
.no-scrollbar {
  -ms-overflow-style: none; /* IE and Edge */
  scrollbar-width: none; /* Firefox */
}
.no-scrollbar::-webkit-scrollbar {
  display: none; /* Chrome, Safari and Opera */
}
</style>
