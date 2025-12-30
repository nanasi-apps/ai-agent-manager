<script setup lang="ts">
import type { CollapsibleContentProps } from "reka-ui";
import { CollapsibleContent } from "reka-ui";
import { computed } from "vue";

const props = defineProps<CollapsibleContentProps & { class?: string }>();

const delegatedProps = computed(() => {
	const { class: _, ...delegated } = props;
	return delegated;
});
</script>

<template>
	<CollapsibleContent
		v-bind="delegatedProps"
		class="overflow-hidden transition-all data-[state=closed]:animate-collapsible-up data-[state=open]:animate-collapsible-down"
		:class="props.class"
	>
		<slot />
	</CollapsibleContent>
</template>
