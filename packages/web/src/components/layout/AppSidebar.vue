<script setup lang="ts">
import {
	BookOpen,
	Bot,
	ChevronRight,
	Folder,
	Home,
	Inbox,
	Loader2,
	PanelLeft,
	Plug,
	Plus,
	Search,
	Settings,
} from "lucide-vue-next";
import { onMounted, onUnmounted, ref, watch, computed, type Component } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useI18n } from "vue-i18n";
import NewProjectDialog from "@/components/dialogs/NewProjectDialog.vue";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
	Sidebar,
	SidebarContent,
	SidebarFooter,
	SidebarGroup,
	SidebarGroupAction,
	SidebarGroupContent,
	SidebarGroupLabel,
	SidebarMenu,
	SidebarMenuAction,
	SidebarMenuButton,
	SidebarMenuItem,
	SidebarMenuSub,
	SidebarMenuSubButton,
	SidebarMenuSubItem,
	useSidebar,
} from "@/components/ui/sidebar";
import { useNewConversionDialogStore } from "@/stores/newConversionDialog";
import { useSettingsStore } from "@/stores/settings";
import { useProjectsStore } from "@/stores/projects";
import { onAgentStateChangedPort } from "@/services/agent-state-port";

const { t } = useI18n();

const router = useRouter();
const route = useRoute();
const activeItem = ref("dashboard");
const isProjectDialogOpen = ref(false);

const settingsStore = useSettingsStore();
const projectsStore = useProjectsStore();

const newConversionDialogStore = useNewConversionDialogStore();
const { open: openNewConversionDialog } = newConversionDialogStore;

const openNewConversion = (projectId: string) => {
  if (settingsStore.newConversionOpenMode === 'dialog'){
    openNewConversionDialog(projectId);
  } else if (settingsStore.newConversionOpenMode === 'page') {
    router.push(`/conversions/new?projectId=${projectId}`);
  } else {
    openNewConversionDialog(projectId);
  }
}

type SidebarItem = {
  id: string;
  title: string;
  url: string;
  icon: Component;
  isRunning?: boolean;
};

// Main navigation items.
const navItems = computed<SidebarItem[]>(() => [
	{
		id: "dashboard",
		title: t('sidebar.dashboard'),
		url: "/",
		icon: Home,
	},
	{
		id: "inbox",
		title: t('general.inbox'),
		url: "/inbox",
		icon: Inbox,
	},
	{
		id: "search",
		title: t('sidebar.search'),
		url: "#",
		icon: Search,
	},
]);

// Sidebar projects computed from store
const sidebarProjects = computed(() => 
	projectsStore.projectsWithConversations.map((p) => ({
		id: p.id,
		name: p.name,
		conversations: p.conversations.map((c) => ({
			id: c.id,
			title: c.title,
			isRunning: c.isProcessing ?? false,
		})),
	}))
);

let refreshInterval: ReturnType<typeof setInterval> | null = null;
let stateChangeUnsubscribe: (() => void) | null = null;

onMounted(async () => {
	projectsStore.loadAll();
	window.addEventListener("agent-manager:data-change", () => projectsStore.loadAll(true));
	refreshInterval = setInterval(() => projectsStore.loadAll(true), 3000);
	
	stateChangeUnsubscribe = onAgentStateChangedPort(() => {
		projectsStore.loadAll(true);
	});
});

onUnmounted(() => {
	window.removeEventListener("agent-manager:data-change", () => projectsStore.loadAll(true));
	if (refreshInterval) clearInterval(refreshInterval);
	if (stateChangeUnsubscribe) stateChangeUnsubscribe();
});

// Update active item based on route
watch(
	() => route.path,
	(path) => {
		if (path === "/") {
			activeItem.value = "dashboard";
		} else if (path === "/inbox") {
			activeItem.value = "inbox";
		} else if (path.startsWith("/projects/")) {
			const id = path.split("/")[2] || "";
			activeItem.value = id;
		} else if (path.startsWith("/conversions/")) {
			const id = path.split("/")[2] || "";
			activeItem.value = id;
		} else if (path === "/agents") {
			activeItem.value = "agents-manager";
		} else if (path === "/rules") {
			activeItem.value = "rules";
		} else if (path === "/settings") {
			activeItem.value = "settings";
		} else if (path === "/mcp") {
			activeItem.value = "mcp-servers";
		}
	},
	{ immediate: true },
);

// Bottom navigation items.
const bottomItems = computed<SidebarItem[]>(() => [
	{
		id: "agents-manager",
		title: t('sidebar.agentsManager'),
		url: "/agents",
		icon: Bot,
	},
	{
		id: "mcp-servers",
		title: t('sidebar.mcpServers'),
		url: "/mcp",
		icon: Plug,
	},
	{
		id: "rules",
		title: t('sidebar.rules'),
		url: "/rules",
		icon: BookOpen,
	},
	{
		id: "settings",
		title: t('sidebar.settings'),
		url: "/settings",
		icon: Settings,
	},
]);

const { setSidebarWidth, setOpen, isResizing, state, toggleSidebar } =
	useSidebar();

function handleItemClick(id: string) {
	activeItem.value = id;
}

function handleMouseDown(e: MouseEvent) {
	isResizing.value = true;

	window.addEventListener("mousemove", handleMouseMove);
	window.addEventListener("mouseup", handleMouseUp);
	e.preventDefault();
}

function handleMouseMove(e: MouseEvent) {
	if (!isResizing.value) return;

	const newWidth = e.clientX;

	if (state.value === "collapsed") {
		if (newWidth > 120) {
			setOpen(true);
			setSidebarWidth(`${newWidth}px`);
		}
	} else {
		if (newWidth < 120) {
			setOpen(false);
		} else {
			if (newWidth <= 600) {
				setSidebarWidth(`${newWidth}px`);
			}
		}
	}
}

function handleMouseUp() {
	isResizing.value = false;
	window.removeEventListener("mousemove", handleMouseMove);
	window.removeEventListener("mouseup", handleMouseUp);
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
            <SidebarMenuItem v-for="item in navItems" :key="item.id">
              <SidebarMenuButton 
                as-child 
                :tooltip="item.title"
                :isActive="activeItem === item.id"
                @click="handleItemClick(item.id)"
                class="transition-all duration-200 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground data-[active=true]:bg-sidebar-accent data-[active=true]:text-sidebar-accent-foreground data-[active=true]:border data-[active=true]:border-sidebar-border data-[active=true]:shadow-sm"
              >
                <router-link :to="item.url" class="flex items-center gap-2 !text-inherit grow overflow-hidden">
                  <component :is="item.icon" class="size-4 shrink-0" />
                  <span class="font-medium truncate">{{ item.title }}</span>
                </router-link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>

      <SidebarGroup class="group-data-[collapsible=icon]:hidden">
        <SidebarGroupLabel>
          {{ t('sidebar.projects') }}
        </SidebarGroupLabel>
        <SidebarGroupAction :title="t('sidebar.addProject')" @click="isProjectDialogOpen = true">
          <Plus /> <span class="sr-only">{{ t('sidebar.addProject') }}</span>
        </SidebarGroupAction>
        <SidebarGroupContent>
          <SidebarMenu>
             <Collapsible 
               v-for="project in sidebarProjects" 
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
                          <div class="size-4 shrink-0 cursor-pointer flex items-center justify-center relative">
                            <Folder class="size-4 transition-opacity group-hover/collapsible:opacity-0" />
                            <ChevronRight 
                              class="size-4 absolute transition-all opacity-0 group-hover/collapsible:opacity-100 group-data-[state=open]/collapsible:rotate-90" 
                            />
                          </div>
                       </CollapsibleTrigger>
                       <router-link :to="`/projects/${project.id}`" class="flex-1 truncate">
                          {{ project.name }}
                       </router-link>
                       <Loader2 v-if="project.conversations.some(c => c.isRunning)" class="size-3 animate-spin shrink-0 text-muted-foreground mr-1" />
                     </div>
                   </SidebarMenuButton>
                   <SidebarMenuAction @click.stop="openNewConversion(project.id)">
                      <Plus /> <span class="sr-only">{{ t('sidebar.newConversion') }}</span>
                   </SidebarMenuAction>
                 </div>

                 <CollapsibleContent class="project-collapsible">
                   <div class="project-collapsible__inner">
                     <SidebarMenuSub v-if="project.conversations.length">
                       <SidebarMenuSubItem v-for="conv in project.conversations.slice(0, 5)" :key="conv.id">
                         <SidebarMenuSubButton 
                           as-child 
                           :isActive="activeItem === conv.id"
                           @click="handleItemClick(conv.id)"
                         >
                           <router-link :to="`/conversions/${conv.id}`" class="flex items-center justify-between gap-1 w-full overflow-hidden">
                             <span class="truncate">{{ conv.title }}</span>
                             <Loader2 v-if="conv.isRunning" class="size-3 animate-spin shrink-0 text-muted-foreground mr-1" />
                           </router-link>
                         </SidebarMenuSubButton>
                       </SidebarMenuSubItem>
                       <SidebarMenuSubItem v-if="project.conversations.length > 5">
                          <SidebarMenuSubButton as-child>
                             <router-link :to="`/projects/${project.id}`" class="text-xs text-muted-foreground hover:text-foreground">
                                {{ t('sidebar.viewAll') }}
                             </router-link>
                          </SidebarMenuSubButton>
                       </SidebarMenuSubItem>
                     </SidebarMenuSub>
                     <SidebarMenuSub v-else>
                        <SidebarMenuSubItem>
                           <span class="text-xs text-muted-foreground px-2 py-1">{{ t('sidebar.noConversations') }}</span>
                        </SidebarMenuSubItem>
                     </SidebarMenuSub>
                   </div>
                 </CollapsibleContent>
               </SidebarMenuItem>
             </Collapsible>
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>
    </SidebarContent>
    
    <SidebarFooter class="border-t p-2">
      <SidebarMenu>
        <template v-for="item in bottomItems" :key="item.id">
          <Collapsible v-if="item.id === 'agents-manager'" as-child class="group/collapsible-agents">
            <SidebarMenuItem>
              <SidebarMenuButton 
                as-child 
                :tooltip="item.title"
                :isActive="activeItem === item.id"
                @click="handleItemClick(item.id)"
                class="transition-all duration-200 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground data-[active=true]:bg-sidebar-accent data-[active=true]:text-sidebar-accent-foreground data-[active=true]:border data-[active=true]:border-sidebar-border data-[active=true]:shadow-sm"
              >
                <router-link :to="item.url" class="flex items-center gap-2 !text-inherit grow overflow-hidden">
                  <component :is="item.icon" class="size-4 shrink-0" />
                  <span class="font-medium truncate">{{ item.title }}</span>
                </router-link>
              </SidebarMenuButton>

              <CollapsibleTrigger as-child>
                <SidebarMenuAction 
                  class="transition-all duration-200 opacity-0 group-hover/collapsible-agents:opacity-100 group-data-[state=open]/collapsible-agents:opacity-100 group-data-[state=open]/collapsible-agents:rotate-90"
                >
                  <ChevronRight class="size-4" />
                  <span class="sr-only">{{ t('sidebar.toggle') }}</span>
                </SidebarMenuAction>
              </CollapsibleTrigger>

              <CollapsibleContent>
                <SidebarMenuSub>
                  <SidebarMenuSubItem>
                    <SidebarMenuSubButton as-child>
                      <router-link to="/agents" class="text-xs">
                        {{ t('sidebar.overview') }}
                      </router-link>
                    </SidebarMenuSubButton>
                  </SidebarMenuSubItem>
                </SidebarMenuSub>
              </CollapsibleContent>
            </SidebarMenuItem>
          </Collapsible>

          <SidebarMenuItem v-else>
            <SidebarMenuButton 
              as-child 
              :tooltip="item.title"
              :isActive="activeItem === item.id"
              @click="handleItemClick(item.id)"
              class="transition-all duration-200 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground data-[active=true]:bg-sidebar-accent data-[active=true]:text-sidebar-accent-foreground data-[active=true]:border data-[active=true]:border-sidebar-border data-[active=true]:shadow-sm"
            >
                <router-link :to="item.url" class="flex items-center gap-2 !text-inherit grow overflow-hidden">
                <component :is="item.icon" class="size-4 shrink-0" />
                <span class="font-medium truncate">{{ item.title }}</span>
                <div v-if="item.isRunning" class="size-2 rounded-full bg-green-500 animate-pulse ml-auto mr-1 shrink-0 shadow-[0_0_8px_rgba(34,197,94,0.6)]" />
              </router-link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </template>
        
        <SidebarMenuItem>
          <SidebarMenuButton 
            @click="toggleSidebar"
            :tooltip="t('sidebar.close')"
            class="w-full justify-start gap-2 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
          >
            <PanelLeft class="size-4" />
            <span class="truncate group-data-[collapsible=icon]:hidden">
              {{ t('sidebar.close') }}
            </span>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    </SidebarFooter>
  </Sidebar>
  <NewProjectDialog 
    :open="isProjectDialogOpen" 
    @update:open="isProjectDialogOpen = $event"
    @created="() => projectsStore.loadAll(true)"
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

.project-collapsible {
  --radix-collapsible-content-height: var(--reka-collapsible-content-height);
  --animate-collapsible-down: collapsible-down 0.28s cubic-bezier(0.2, 0.8, 0.2, 1);
  --animate-collapsible-up: collapsible-up 0.2s cubic-bezier(0.4, 0, 0.2, 1);
  transform-origin: top;
  will-change: height, opacity, transform;
}

.project-collapsible__inner {
  transform-origin: top;
  transition:
    opacity 0.18s ease,
    transform 0.22s cubic-bezier(0.2, 0.8, 0.2, 1);
}

.project-collapsible[data-state="open"] .project-collapsible__inner {
  opacity: 1;
  transform: translateY(0);
}

.project-collapsible[data-state="closed"] .project-collapsible__inner {
  opacity: 0;
  transform: translateY(-6px);
}
</style>
