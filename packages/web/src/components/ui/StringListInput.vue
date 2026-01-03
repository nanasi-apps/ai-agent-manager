<script setup lang="ts">
import { ref } from "vue";
import { Plus, X } from "lucide-vue-next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const props = defineProps<{
	modelValue: string[];
	label?: string;
	placeholder?: string;
}>();

const emit = defineEmits<{
	(e: "update:modelValue", value: string[]): void;
}>();

const inputValue = ref("");

const addItem = () => {
	const val = inputValue.value.trim();
	if (val && !props.modelValue.includes(val)) {
		emit("update:modelValue", [...props.modelValue, val]);
		inputValue.value = "";
	}
};

const removeItem = (index: number) => {
	const newValue = [...props.modelValue];
	newValue.splice(index, 1);
	emit("update:modelValue", newValue);
};

const handleKeydown = (e: KeyboardEvent) => {
	if (e.key === "Enter") {
		e.preventDefault();
		addItem();
	}
};
</script>

<template>
  <div class="space-y-2">
    <label v-if="label" class="text-sm font-medium">{{ label }}</label>
    <div class="flex gap-2">
      <Input
        v-model="inputValue"
        :placeholder="placeholder || 'Add item...'"
        @keydown="handleKeydown"
        class="flex-1"
      />
      <Button variant="secondary" size="icon" type="button" @click="addItem">
        <Plus class="size-4" />
      </Button>
    </div>
    <div v-if="modelValue.length > 0" class="flex flex-wrap gap-2 mt-2">
      <div
        v-for="(item, index) in modelValue"
        :key="index"
        class="bg-secondary text-secondary-foreground px-2 py-1 rounded-md text-sm flex items-center gap-1 group"
      >
        <span>{{ item }}</span>
        <button
          type="button"
          class="opacity-50 group-hover:opacity-100 hover:text-destructive transition-opacity"
          @click="removeItem(index)"
        >
          <X class="size-3" />
        </button>
      </div>
    </div>
    <p v-else class="text-xs text-muted-foreground italic">No items defined.</p>
  </div>
</template>
