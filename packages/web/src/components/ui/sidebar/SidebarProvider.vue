<script setup lang="ts">
import type { HTMLAttributes, Ref } from "vue"
import { defaultDocument, useEventListener, useVModel } from "@vueuse/core"
import { TooltipProvider } from "reka-ui"
import { computed, ref } from "vue"
import { cn } from "@/lib/utils"
import { provideSidebarContext, SIDEBAR_COOKIE_MAX_AGE, SIDEBAR_COOKIE_NAME, SIDEBAR_KEYBOARD_SHORTCUT, SIDEBAR_WIDTH, SIDEBAR_WIDTH_ICON } from "./utils"

const props = withDefaults(defineProps<{
  defaultOpen?: boolean
  open?: boolean
  class?: HTMLAttributes["class"]
}>(), {
  defaultOpen: !defaultDocument?.cookie.includes(`${SIDEBAR_COOKIE_NAME}=false`),
  open: undefined,
})

const emits = defineEmits<{
  "update:open": [open: boolean]
}>()

const open = useVModel(props, "open", emits, {
  defaultValue: props.defaultOpen ?? false,
  passive: (props.open === undefined) as false,
}) as Ref<boolean>

function setOpen(value: boolean) {
  open.value = value
  document.cookie = `${SIDEBAR_COOKIE_NAME}=${open.value}; path=/; max-age=${SIDEBAR_COOKIE_MAX_AGE}`
}

function toggleSidebar() {
  setOpen(!open.value)
}

useEventListener("keydown", (event: KeyboardEvent) => {
  if (event.key === SIDEBAR_KEYBOARD_SHORTCUT && (event.metaKey || event.ctrlKey)) {
    event.preventDefault()
    toggleSidebar()
  }
})

const state = computed(() => open.value ? "expanded" : "collapsed")

const SIDEBAR_WIDTH_COOKIE_NAME = "sidebar_width"

const sidebarWidth = ref(document?.cookie.match(new RegExp(`(?:^|; )${SIDEBAR_WIDTH_COOKIE_NAME}=([^;]*)`))?.[1] ?? SIDEBAR_WIDTH)

function setSidebarWidth(value: string) {
  sidebarWidth.value = value
  document.cookie = `${SIDEBAR_WIDTH_COOKIE_NAME}=${value}; path=/; max-age=${SIDEBAR_COOKIE_MAX_AGE}`
}

const isResizing = ref(false)

provideSidebarContext({
  state,
  open,
  setOpen,
  isMobile: ref(false),
  openMobile: ref(false),
  setOpenMobile: () => {},
  toggleSidebar,
  sidebarWidth,
  setSidebarWidth,
  isResizing,
})
</script>

<template>
  <TooltipProvider :delay-duration="0">
    <div
      data-slot="sidebar-wrapper"
      :data-resizing="isResizing"
      :style="{
        '--sidebar-width': sidebarWidth,
        '--sidebar-width-icon': SIDEBAR_WIDTH_ICON,
      }"
      :class="cn(
        'group/sidebar-wrapper has-data-[variant=inset]:bg-sidebar flex min-h-svh w-full',
        isResizing && '!transition-none',
        props.class
      )"
      v-bind="$attrs"
    >
      <slot />
    </div>
  </TooltipProvider>
</template>
