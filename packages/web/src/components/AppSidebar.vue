<script setup lang="ts">
import { ref } from "vue"
import { Home, Settings, Bot, Inbox, Search, PanelLeft } from "lucide-vue-next"
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
  useSidebar,
} from "@/components/ui/sidebar"

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

// Mock projects data
const projects = [
  {
    id: "p1",
    name: "Project 1",
    conversations: [
      { id: "1-1", title: "conversation 1" },
      { id: "1-2", title: "conversation 2" },
      { id: "1-3", title: "conversation 3" },
    ]
  },
  {
    id: "p2",
    name: "Project 2",
    conversations: [
      { id: "2-1", title: "conversation 1" },
      { id: "2-2", title: "conversation 2" },
      { id: "2-3", title: "conversation 3" },
    ]
  },
  {
    id: "p3",
    name: "Project 3",
    conversations: [
      { id: "3-1", title: "conversation 1" },
      { id: "3-2", title: "conversation 2 mettyanagai namae dayo" },
      { id: "3-3", title: "conversation 3" },
    ]
  }
]

// Bottom navigation items.
const bottomItems = [
  {
    title: "Agents",
    url: "/agents",
    icon: Bot,
  },
  {
    title: "Settings",
    url: "/settings",
    icon: Settings,
  },
]

const { setSidebarWidth, setOpen, isResizing, state, toggleSidebar } = useSidebar()
const activeItem = ref("Dashboard")

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
      class="absolute -right-[2px] top-0 bottom-0 w-1 cursor-col-resize z-50 transition-colors border-r-2 border-transparent hover:border-primary hover:bg-primary/40"
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
                class="transition-all duration-200 border border-solid border-transparent hover:border-primary/50 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground data-[active=true]:border-primary data-[active=true]:bg-sidebar-accent data-[active=true]:text-sidebar-accent-foreground"
              >
                <router-link :to="item.url" class="flex items-center gap-2 !text-inherit">
                  <component :is="item.icon" class="size-4" />
                  <span class="font-medium">{{ item.title }}</span>
                </router-link>
              </SidebarMenuButton>

              <template v-if="item.title === 'Search'">
                <div v-for="project in projects" :key="project.name" class="mt-2 group-data-[collapsible=icon]:hidden">
                  <router-link 
                    :to="`/projects/${project.id}`"
                    class="px-4 py-1 text-[10px] font-semibold text-muted-foreground uppercase tracking-widest block hover:text-foreground transition-colors"
                  >
                    {{ project.name }}
                  </router-link>
                  <SidebarMenuSub class="ml-4 border-sidebar-border">
                    <SidebarMenuSubItem v-for="conv in project.conversations" :key="conv.id">
                      <SidebarMenuSubButton 
                        as-child
                        :isActive="activeItem === conv.id"
                        @click="handleItemClick(conv.id)"
                        class="transition-all duration-200 border border-solid border-transparent hover:border-primary/50 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground data-[active=true]:border-primary data-[active=true]:bg-sidebar-accent data-[active=true]:text-sidebar-accent-foreground"
                      >
                        <router-link :to="`/conversions/${conv.id}`" class="flex items-center gap-2 overflow-x-auto whitespace-nowrap no-scrollbar !text-inherit" :title="conv.title">
                          <span class="block min-w-max text-xs">{{ conv.title }}</span>
                        </router-link>
                      </SidebarMenuSubButton>
                    </SidebarMenuSubItem>
                  </SidebarMenuSub>
                </div>
              </template>
            </SidebarMenuItem>
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
                class="transition-all duration-200 border border-solid border-transparent hover:border-primary/50 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground data-[active=true]:border-primary data-[active=true]:bg-sidebar-accent data-[active=true]:text-sidebar-accent-foreground"
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
            class="w-full justify-start gap-2 border border-solid border-transparent hover:border-primary/50 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
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
