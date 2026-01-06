<script setup lang="ts">
import { Plus, X } from "lucide-vue-next";
import { ref } from "vue";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const props = defineProps<{
	modelValue: string[];
	label?: string;
	placeholder?: string;
	helpText?: string;
}>();

const emit = defineEmits<(e: "update:modelValue", value: string[]) => void>();

const inputValue = ref("");

const splitValues = (raw: string) => {
	return raw
		.split(/[,\n]/)
		.map((entry) => entry.trim())
		.filter(Boolean);
};

const uniqueList = (list: string[]) => {
	const seen = new Set<string>();
	return list.filter((item) => {
		if (seen.has(item)) return false;
		seen.add(item);
		return true;
	});
};

const addItem = () => {
	const values = splitValues(inputValue.value);
	if (values.length > 0) {
		emit("update:modelValue", uniqueList([...props.modelValue, ...values]));
		inputValue.value = "";
	}
};

const removeItem = (index: number) => {
	const newValue = [...props.modelValue];
	newValue.splice(index, 1);
	emit("update:modelValue", newValue);
};

const updateItem = (index: number, value: string) => {
	const newValue = [...props.modelValue];
	newValue[index] = value;
	emit("update:modelValue", newValue);
};

const normalizeItem = (index: number) => {
	const newValue = [...props.modelValue];
	const trimmed = newValue[index]?.trim() ?? "";
	if (!trimmed) {
		newValue.splice(index, 1);
		emit("update:modelValue", newValue);
		return;
	}
	newValue[index] = trimmed;
	const deduped = newValue.filter(
		(item, idx) => item !== trimmed || idx === index,
	);
	emit("update:modelValue", deduped);
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
        :placeholder="placeholder || 'Add item(s)...'"
        @keydown="handleKeydown"
        class="flex-1"
      />
      <Button variant="secondary" size="icon" type="button" @click="addItem">
        <Plus class="size-4" />
      </Button>
    </div>
    <p v-if="helpText" class="text-xs text-muted-foreground">{{ helpText }}</p>
    <div v-if="modelValue.length > 0" class="space-y-2 mt-2">
      <div v-for="(item, index) in modelValue" :key="index" class="flex gap-2">
        <Input
          :model-value="item"
          class="flex-1"
          @update:model-value="(val: string | number) => updateItem(index, String(val))"
          @blur="() => normalizeItem(index)"
        />
        <Button
          variant="ghost"
          size="icon"
          type="button"
          class="text-muted-foreground hover:text-destructive"
          @click="removeItem(index)"
        >
          <X class="size-4" />
        </Button>
      </div>
    </div>
    <p v-else class="text-xs text-muted-foreground italic">No items defined.</p>
  </div>
</template>
