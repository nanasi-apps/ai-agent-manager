<script setup lang="ts">
import type { AutoConfig, GtrConfig, ProjectRule } from "@agent-manager/shared";
import { ArrowLeft, FileText, Loader2, Plus, Trash2 } from "lucide-vue-next";
import { computed, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import StringListInput from "@/components/ui/StringListInput.vue";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { MIN_LOAD_TIME } from "@/lib/constants";
import { getRouteParamFrom } from "@/lib/route-params";
import { orpc } from "@/services/orpc";

const route = useRoute();
const router = useRouter();
const projectId = computed(() => getRouteParamFrom(route.params, "id"));
const project = ref<{
	id: string;
	name: string;
	rootPath?: string;
	activeGlobalRules?: string[];
	projectRules?: ProjectRule[];
	autoConfig?: AutoConfig;
} | null>(null);
const nameDraft = ref("");
const rootPathDraft = ref("");
const isLoading = ref(true);
const isSavingProject = ref(false);
const hasNativePicker = computed(() => {
	return typeof window !== "undefined" && !!window.electronAPI;
});
const globalRules = ref<{ id: string; name: string }[]>([]);
const activeGlobalRulesDraft = ref<string[]>([]);
const projectRulesDraft = ref<ProjectRule[]>([]);
const gtrConfigDraft = ref<GtrConfig>({
	copy: { include: [], exclude: [], includeDirs: [], excludeDirs: [] },
	hooks: { postCreate: [] },
});
const gtrConfigOriginal = ref<GtrConfig | null>(null);
type CopyEntryType = "file" | "dir";
type CopyEntry = { value: string; type: CopyEntryType };
const includeEntries = ref<CopyEntry[]>([]);
const excludeEntries = ref<CopyEntry[]>([]);
const includeAddValue = ref("");
const includeAddType = ref<CopyEntryType>("file");
const excludeAddValue = ref("");
const excludeAddType = ref<CopyEntryType>("file");

// AutoConfig for automated project startup
const autoConfigJsonDraft = ref<string>("");
const autoConfigOriginal = ref<AutoConfig | null>(null);
const autoConfigParseError = ref<string | null>(null);

const validateAutoConfigJson = (json: string): AutoConfig | null => {
	if (!json.trim()) return null;
	try {
		const parsed = JSON.parse(json);
		// Basic validation
		if (!parsed.type || !["web", "process", "other"].includes(parsed.type)) {
			autoConfigParseError.value = "type must be 'web', 'process', or 'other'";
			return null;
		}
		// Support both new 'startCommand' and legacy 'command'
		const command = parsed.startCommand ?? parsed.command;
		if (typeof command !== "string") {
			autoConfigParseError.value = "startCommand must be a string";
			return null;
		}
		// Normalize to new format
		if (!parsed.startCommand && parsed.command) {
			parsed.startCommand = parsed.command;
			delete parsed.command;
		}
		// Support both new 'services' array and legacy 'ports' object
		if (parsed.ports && !parsed.services) {
			// Convert legacy ports to services format
			parsed.services = Object.entries(parsed.ports).map(([envKey, defaultPort]) => ({
				name: envKey,
				envKey,
				default: defaultPort as number,
			}));
			delete parsed.ports;
		}
		if (!Array.isArray(parsed.services)) {
			parsed.services = [];
		}
		// Normalize service configs: support envVar/port aliases
		parsed.services = parsed.services.map((svc: any) => ({
			name: svc.name,
			envKey: svc.envKey ?? svc.envVar,
			default: svc.default ?? svc.port,
			argument: svc.argument,
			ui: svc.ui,
		}));
		autoConfigParseError.value = null;
		return parsed as AutoConfig;
	} catch (e) {
		autoConfigParseError.value =
			e instanceof Error ? e.message : "Invalid JSON";
		return null;
	}
};

// Project Rules Logic
const selectedProjectRuleId = ref<string | null>(null);
const selectedRule = computed(() =>
	projectRulesDraft.value.find((r) => r.id === selectedProjectRuleId.value),
);

const createProjectRule = () => {
	const newRule: ProjectRule = {
		id: crypto.randomUUID(),
		name: "New Rule",
		content: "",
	};
	projectRulesDraft.value.push(newRule);
	selectedProjectRuleId.value = newRule.id;
};

const deleteProjectRule = (id: string, event?: Event) => {
	event?.stopPropagation();
	if (!confirm("Are you sure you want to delete this rule?")) return;

	projectRulesDraft.value = projectRulesDraft.value.filter((r) => r.id !== id);
	if (selectedProjectRuleId.value === id) {
		selectedProjectRuleId.value = null;
	}
};

const loadProject = async () => {
	const id = projectId.value;
	if (!id) return;

	isLoading.value = true;
	const minLoadTime = new Promise((resolve) =>
		setTimeout(resolve, MIN_LOAD_TIME),
	);

	try {
		const [p, rules, gtrConfig] = await Promise.all([
			orpc.getProject({ projectId: id }),
			orpc.listGlobalRules(),
			orpc.getGtrConfig({ projectId: id }),
		]);
		globalRules.value = rules;
		gtrConfigOriginal.value = gtrConfig;
		gtrConfigDraft.value = JSON.parse(JSON.stringify(gtrConfig));

		if (!p) {
			project.value = null;
			return;
		}
		// Ensure projectRules is parsed correctly or initialized
		const parsedProject = {
			...p,
			projectRules:
				p?.projectRules && Array.isArray(p.projectRules) ? p.projectRules : [],
		};
		project.value = parsedProject;
	} catch (e) {
		console.error(e);
	} finally {
		await minLoadTime;
		isLoading.value = false;
	}
};

const resetSettings = () => {
	nameDraft.value = project.value?.name || "";
	rootPathDraft.value = project.value?.rootPath || "";
	activeGlobalRulesDraft.value = project.value?.activeGlobalRules
		? [...project.value.activeGlobalRules]
		: [];
	// Deep copy project rules
	projectRulesDraft.value = project.value?.projectRules
		? JSON.parse(JSON.stringify(project.value.projectRules))
		: [];
	selectedProjectRuleId.value = null;

	if (gtrConfigOriginal.value) {
		gtrConfigDraft.value = JSON.parse(JSON.stringify(gtrConfigOriginal.value));
	}
	const draft = gtrConfigDraft.value;
	includeEntries.value = [
		...draft.copy.include.map((value) => ({ value, type: "file" as const })),
		...draft.copy.includeDirs.map((value) => ({
			value,
			type: "dir" as const,
		})),
	];
	excludeEntries.value = [
		...draft.copy.exclude.map((value) => ({ value, type: "file" as const })),
		...draft.copy.excludeDirs.map((value) => ({
			value,
			type: "dir" as const,
		})),
	];

	// Reset AutoConfig
	autoConfigOriginal.value = project.value?.autoConfig ?? null;
	autoConfigJsonDraft.value = autoConfigOriginal.value
		? JSON.stringify(autoConfigOriginal.value, null, 2)
		: "";
	autoConfigParseError.value = null;
};

const syncIncludeConfig = () => {
	const normalized = includeEntries.value
		.map((entry) => ({ ...entry, value: entry.value.trim() }))
		.filter((entry) => entry.value);
	gtrConfigDraft.value.copy.include = normalized
		.filter((entry) => entry.type === "file")
		.map((entry) => entry.value);
	gtrConfigDraft.value.copy.includeDirs = normalized
		.filter((entry) => entry.type === "dir")
		.map((entry) => entry.value);
};

const syncExcludeConfig = () => {
	const normalized = excludeEntries.value
		.map((entry) => ({ ...entry, value: entry.value.trim() }))
		.filter((entry) => entry.value);
	gtrConfigDraft.value.copy.exclude = normalized
		.filter((entry) => entry.type === "file")
		.map((entry) => entry.value);
	gtrConfigDraft.value.copy.excludeDirs = normalized
		.filter((entry) => entry.type === "dir")
		.map((entry) => entry.value);
};

const splitList = (value: string) =>
	value
		.split(/[,\n]/)
		.map((entry) => entry.trim())
		.filter(Boolean);

const appendEntries = (
	entries: CopyEntry[],
	values: string[],
	type: CopyEntryType,
) => {
	const existing = new Set(entries.map((entry) => `${entry.type}::${entry.value}`));
	const added = values
		.map((value) => value.trim())
		.filter(Boolean)
		.filter((value) => {
			const key = `${type}::${value}`;
			if (existing.has(key)) return false;
			existing.add(key);
			return true;
		})
		.map((value) => ({ value, type }));
	return [...entries, ...added];
};

const normalizeDialogPath = (value: string) => {
	const root = rootPathDraft.value.trim().replace(/\/+$/, "");
	if (!root) return value;
	const prefix = `${root}/`;
	if (value.startsWith(prefix)) {
		return value.slice(prefix.length);
	}
	return value;
};

const addIncludeEntries = () => {
	const values = splitList(includeAddValue.value);
	if (values.length === 0) return;
	includeEntries.value = appendEntries(
		includeEntries.value,
		values,
		includeAddType.value,
	);
	includeAddValue.value = "";
	syncIncludeConfig();
};

const addExcludeEntries = () => {
	const values = splitList(excludeAddValue.value);
	if (values.length === 0) return;
	excludeEntries.value = appendEntries(
		excludeEntries.value,
		values,
		excludeAddType.value,
	);
	excludeAddValue.value = "";
	syncExcludeConfig();
};

const pickIncludeEntries = async () => {
	if (!hasNativePicker.value) return;
	const selected = await orpc.selectPaths({
		type: includeAddType.value === "file" ? "file" : "dir",
		multiple: true,
	});
	if (selected.length === 0) return;
	const values = selected.map(normalizeDialogPath);
	includeEntries.value = appendEntries(
		includeEntries.value,
		values,
		includeAddType.value,
	);
	syncIncludeConfig();
};

const pickExcludeEntries = async () => {
	if (!hasNativePicker.value) return;
	const selected = await orpc.selectPaths({
		type: excludeAddType.value === "file" ? "file" : "dir",
		multiple: true,
	});
	if (selected.length === 0) return;
	const values = selected.map(normalizeDialogPath);
	excludeEntries.value = appendEntries(
		excludeEntries.value,
		values,
		excludeAddType.value,
	);
	syncExcludeConfig();
};

const updateIncludeEntry = (index: number, patch: Partial<CopyEntry>) => {
	const next = [...includeEntries.value];
	if (!next[index]) return;
	next[index] = { ...next[index], ...patch };
	includeEntries.value = next;
	syncIncludeConfig();
};

const updateExcludeEntry = (index: number, patch: Partial<CopyEntry>) => {
	const next = [...excludeEntries.value];
	if (!next[index]) return;
	next[index] = { ...next[index], ...patch };
	excludeEntries.value = next;
	syncExcludeConfig();
};

const normalizeIncludeEntry = (index: number) => {
	const entries = [...includeEntries.value];
	const entry = entries[index];
	if (!entry) return;
	const trimmed = entry.value.trim();
	if (!trimmed) {
		entries.splice(index, 1);
		includeEntries.value = entries;
		syncIncludeConfig();
		return;
	}
	const duplicateIndex = entries.findIndex(
		(e, i) => i !== index && e.type === entry.type && e.value.trim() === trimmed,
	);
	if (duplicateIndex !== -1) {
		entries.splice(index, 1);
		includeEntries.value = entries;
		syncIncludeConfig();
		return;
	}
	entries[index] = { ...entry, value: trimmed };
	includeEntries.value = entries;
	syncIncludeConfig();
};

const normalizeExcludeEntry = (index: number) => {
	const entries = [...excludeEntries.value];
	const entry = entries[index];
	if (!entry) return;
	const trimmed = entry.value.trim();
	if (!trimmed) {
		entries.splice(index, 1);
		excludeEntries.value = entries;
		syncExcludeConfig();
		return;
	}
	const duplicateIndex = entries.findIndex(
		(e, i) => i !== index && e.type === entry.type && e.value.trim() === trimmed,
	);
	if (duplicateIndex !== -1) {
		entries.splice(index, 1);
		excludeEntries.value = entries;
		syncExcludeConfig();
		return;
	}
	entries[index] = { ...entry, value: trimmed };
	excludeEntries.value = entries;
	syncExcludeConfig();
};

const removeIncludeEntry = (index: number) => {
	const next = [...includeEntries.value];
	next.splice(index, 1);
	includeEntries.value = next;
	syncIncludeConfig();
};

const removeExcludeEntry = (index: number) => {
	const next = [...excludeEntries.value];
	next.splice(index, 1);
	excludeEntries.value = next;
	syncExcludeConfig();
};

const isSettingsDirty = computed(() => {
	if (!project.value) return false;
	return (
		nameDraft.value !== project.value.name ||
		rootPathDraft.value !== (project.value.rootPath || "") ||
		JSON.stringify(activeGlobalRulesDraft.value.sort()) !==
			JSON.stringify((project.value.activeGlobalRules || []).sort()) ||
		projectRulesDraft.value.length !==
			(project.value.projectRules || []).length ||
		JSON.stringify(
			projectRulesDraft.value
				.map((r) => ({ name: r.name, content: r.content }))
				.sort((a, b) => a.name.localeCompare(b.name)),
		) !==
			JSON.stringify(
				(project.value.projectRules || [])
					.map((r) => ({ name: r.name, content: r.content }))
					.sort((a, b) => a.name.localeCompare(b.name)),
			) ||
		JSON.stringify(gtrConfigDraft.value) !==
			JSON.stringify(gtrConfigOriginal.value) ||
		// AutoConfig dirty check
		autoConfigJsonDraft.value.trim() !==
			(autoConfigOriginal.value
				? JSON.stringify(autoConfigOriginal.value, null, 2)
				: "")
	);
});

const saveProjectSettings = async () => {
	const id = projectId.value;
	if (!project.value || !id) return;
	const trimmedName = nameDraft.value.trim();
	if (!trimmedName) return;

	const trimmedRoot = rootPathDraft.value.trim();

	isSavingProject.value = true;
	try {
		const [updateResult] = await Promise.all([
			orpc.updateProject({
				projectId: id,
				name: trimmedName,
				rootPath: trimmedRoot ? trimmedRoot : null,
				activeGlobalRules: activeGlobalRulesDraft.value,
				projectRules: projectRulesDraft.value,
				autoConfig: autoConfigJsonDraft.value.trim()
					? validateAutoConfigJson(autoConfigJsonDraft.value)
					: null,
			}),
			orpc.updateGtrConfig({
				projectId: id,
				config: gtrConfigDraft.value,
			}),
		]);

		if (updateResult.success) {
			project.value = {
				...project.value,
				name: trimmedName,
				rootPath: trimmedRoot || undefined,
				activeGlobalRules: activeGlobalRulesDraft.value,
				projectRules: JSON.parse(JSON.stringify(projectRulesDraft.value)),
				autoConfig: autoConfigJsonDraft.value.trim()
					? (validateAutoConfigJson(autoConfigJsonDraft.value) ?? undefined)
					: undefined,
			};
			gtrConfigOriginal.value = JSON.parse(
				JSON.stringify(gtrConfigDraft.value),
			);
			autoConfigOriginal.value = project.value.autoConfig ?? null;
			window.dispatchEvent(new Event("agent-manager:data-change"));
		}
	} catch (e) {
		console.error(e);
	} finally {
		isSavingProject.value = false;
	}
};

const browseRootPath = async () => {
	if (!hasNativePicker.value) return;
	try {
		const selected = await orpc.selectDirectory();
		if (selected) {
			rootPathDraft.value = selected;
		}
	} catch (e) {
		console.error(e);
	}
};

watch(project, () => {
	resetSettings();
});

watch(projectId, loadProject, { immediate: true });
</script>

<template>
  <div class="p-6 pb-24">
    <Transition name="fade" mode="out-in">
      <div v-if="isLoading" class="flex items-center justify-center py-20">
        <Loader2 class="size-8 animate-spin text-muted-foreground" />
      </div>

      <div v-else>
        <div class="flex items-center justify-between mb-8">
          <div>
            <h1 class="text-2xl font-bold">Project Settings</h1>
            <p class="text-muted-foreground">
              {{ project?.name || projectId }}
            </p>
          </div>
          <Button variant="secondary" @click="router.push(`/projects/${projectId}`)">
            <ArrowLeft class="w-4 h-4 mr-2" />
            Back
          </Button>
        </div>

        <div class="border rounded-lg p-4 bg-card/60">
          <div class="mt-1 grid gap-4 md:grid-cols-2">
            <div class="space-y-2">
              <label class="text-sm font-medium">Name</label>
              <Input v-model="nameDraft" placeholder="Project name" />
            </div>
            <div class="space-y-2">
              <label class="text-sm font-medium">Root path</label>
              <div class="flex gap-2">
                <Input v-model="rootPathDraft" placeholder="/path/to/project" class="flex-1" />
                <Button
                  variant="secondary"
                  type="button"
                  :disabled="!hasNativePicker || isSavingProject"
                  @click="browseRootPath"
                >
                  Browse
                </Button>
              </div>
            </div>
          </div>
        </div>

        <div class="mt-6 border rounded-lg p-4 bg-card/60">
             <h2 class="text-lg font-semibold mb-4">Rules</h2>
             
             <div class="space-y-6">
                 <!-- Global Rules Section -->
                 <div>
                     <h3 class="text-sm font-medium mb-3">Global Rules</h3>
                     <div v-if="globalRules.length > 0" class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                         <div v-for="rule in globalRules" :key="rule.id" class="flex items-center space-x-2 border p-3 rounded-md bg-background">
                             <Checkbox 
                                 :id="`rule-${rule.id}`" 
                                 :checked="activeGlobalRulesDraft.includes(rule.id)"
                                 @update:checked="(checked: any) => {
                                     if (checked) {
                                         activeGlobalRulesDraft.push(rule.id)
                                     } else {
                                         activeGlobalRulesDraft = activeGlobalRulesDraft.filter(id => id !== rule.id)
                                     }
                                 }"
                             />
                             <label
                                 :for="`rule-${rule.id}`"
                                 class="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer select-none"
                             >
                                 {{ rule.name }}
                             </label>
                         </div>
                     </div>
                     <p v-else class="text-sm text-muted-foreground italic">No global rules defined.</p>
                 </div>

                 <!-- Project Specific Rules Master-Detail View -->
                 <div>
                     <label class="text-sm font-medium mb-2 block">Project Specific Rules</label>
                     <div class="flex h-[500px] border rounded-md overflow-hidden bg-background">
                        <!-- Sidebar List -->
                        <div class="w-64 border-r flex flex-col bg-muted/10">
                            <div class="p-3 border-b flex items-center justify-between">
                                <span class="text-xs font-semibold text-muted-foreground uppercase">Rules List</span>
                                <Button size="icon" variant="ghost" class="h-6 w-6" @click="createProjectRule">
                                    <Plus class="size-4" />
                                </Button>
                            </div>
                            <ScrollArea class="flex-1">
                                <div class="p-2 space-y-1">
                                    <button 
                                        v-for="rule in projectRulesDraft" 
                                        :key="rule.id"
                                        @click="selectedProjectRuleId = rule.id"
                                        :class="['w-full group flex items-center gap-2 px-2 py-1.5 text-sm rounded-md transition-colors text-left outline-none', selectedProjectRuleId === rule.id ? 'bg-accent text-accent-foreground' : 'hover:bg-muted/50 text-muted-foreground hover:text-foreground']"
                                    >
                                        <FileText class="size-3.5 opacity-70" />
                                        <span class="truncate flex-1">{{ rule.name }}</span>
                                        <div 
                                            class="opacity-0 group-hover:opacity-100 transition-opacity"
                                            @click.stop="deleteProjectRule(rule.id, $event)"
                                        >
                                            <Trash2 class="size-3.5 text-muted-foreground hover:text-destructive" />
                                        </div>
                                    </button>
                                </div>
                            </ScrollArea>
                        </div>
                        
                        <div class="flex-1 flex flex-col min-w-0" v-if="selectedRule">
                             <div class="p-4 border-b flex flex-col gap-1 bg-muted/5">
                                 <label class="text-xs font-medium text-muted-foreground">Rule Name</label>
                                 <Input v-model="selectedRule.name" class="font-medium" placeholder="Rule Name" />
                             </div>
                             <div class="flex-1 relative">
                                 <Textarea 
                                     v-model="selectedRule.content" 
                                     placeholder="Write your rule logic here (Markdown)..."
                                     class="w-full h-full absolute inset-0 border-0 rounded-none resize-none focus-visible:ring-0 p-4 font-mono text-sm leading-relaxed" 
                                 />
                             </div>
                        </div>
                        
                        <!-- Empty State -->
                        <div v-else class="flex-1 flex items-center justify-center text-muted-foreground bg-muted/5">
                            <div class="text-center">
                                <FileText class="size-10 mx-auto mb-3 opacity-20" />
                                <p class="text-sm">Select or create a rule to edit</p>
                            </div>
                        </div>
                     </div>
                 </div>
             </div>
        </div>

        <div class="mt-6 border rounded-lg p-4 bg-card/60">
            <h2 class="text-lg font-semibold mb-4">Git Worktree Configuration</h2>
            <p class="text-sm text-muted-foreground mb-4">
              Configure how new worktrees are initialized. These settings are stored in <code>.gtrconfig</code> in your project root.
            </p>

            <div class="space-y-6">
               <div>
                  <h3 class="text-sm font-medium mb-3">Copy Settings</h3>
                  <div class="space-y-6">
                      <div class="space-y-2 border rounded-lg p-4 bg-background/70">
                          <label class="text-sm font-medium">Include (Files & Folders)</label>
                          <div class="flex gap-2">
                              <select
                                  v-model="includeAddType"
                                  class="h-9 rounded-md border border-input bg-transparent px-2 text-sm shadow-xs"
                              >
                                  <option value="file">File</option>
                                  <option value="dir">Folder</option>
                              </select>
                              <Input
                                  v-model="includeAddValue"
                                  placeholder="Add paths or globs (comma/newline for multiple)"
                                  class="flex-1"
                                  @keydown.enter.prevent="addIncludeEntries"
                              />
                              <Button
                                  variant="secondary"
                                  type="button"
                                  :disabled="!hasNativePicker"
                                  @click="pickIncludeEntries"
                              >
                                  Pick
                              </Button>
                              <Button variant="secondary" type="button" @click="addIncludeEntries">
                                  <Plus class="size-4 mr-1" />
                                  Add
                              </Button>
                          </div>
                          <p class="text-xs text-muted-foreground">
                            Edit rows directly. Empty values are removed on blur.
                          </p>
                          <div v-if="includeEntries.length" class="space-y-2">
                              <div
                                  v-for="(entry, index) in includeEntries"
                                  :key="`include-${index}`"
                                  class="flex gap-2"
                              >
                                  <select
                                      :value="entry.type"
                                      class="h-9 rounded-md border border-input bg-transparent px-2 text-sm shadow-xs"
                                      @change="updateIncludeEntry(index, { type: ($event.target as HTMLSelectElement).value as CopyEntryType })"
                                  >
                                      <option value="file">File</option>
                                      <option value="dir">Folder</option>
                                  </select>
                                  <Input
                                      :model-value="entry.value"
                                      class="flex-1"
                                      placeholder="e.g. **/.env.example or node_modules"
                                      @update:model-value="(val: string) => updateIncludeEntry(index, { value: val })"
                                      @blur="() => normalizeIncludeEntry(index)"
                                  />
                                  <Button
                                      variant="ghost"
                                      size="icon"
                                      type="button"
                                      class="text-muted-foreground hover:text-destructive"
                                      @click="removeIncludeEntry(index)"
                                  >
                                      <Trash2 class="size-4" />
                                  </Button>
                              </div>
                          </div>
                          <p v-else class="text-xs text-muted-foreground italic">No include rules defined.</p>
                      </div>
                      <div class="space-y-2 border rounded-lg p-4 bg-background/70">
                          <label class="text-sm font-medium">Exclude (Files & Folders)</label>
                          <div class="flex gap-2">
                              <select
                                  v-model="excludeAddType"
                                  class="h-9 rounded-md border border-input bg-transparent px-2 text-sm shadow-xs"
                              >
                                  <option value="file">File</option>
                                  <option value="dir">Folder</option>
                              </select>
                              <Input
                                  v-model="excludeAddValue"
                                  placeholder="Add paths or globs (comma/newline for multiple)"
                                  class="flex-1"
                                  @keydown.enter.prevent="addExcludeEntries"
                              />
                              <Button
                                  variant="secondary"
                                  type="button"
                                  :disabled="!hasNativePicker"
                                  @click="pickExcludeEntries"
                              >
                                  Pick
                              </Button>
                              <Button variant="secondary" type="button" @click="addExcludeEntries">
                                  <Plus class="size-4 mr-1" />
                                  Add
                              </Button>
                          </div>
                          <p class="text-xs text-muted-foreground">
                            Edit rows directly. Empty values are removed on blur.
                          </p>
                          <div v-if="excludeEntries.length" class="space-y-2">
                              <div
                                  v-for="(entry, index) in excludeEntries"
                                  :key="`exclude-${index}`"
                                  class="flex gap-2"
                              >
                                  <select
                                      :value="entry.type"
                                      class="h-9 rounded-md border border-input bg-transparent px-2 text-sm shadow-xs"
                                      @change="updateExcludeEntry(index, { type: ($event.target as HTMLSelectElement).value as CopyEntryType })"
                                  >
                                      <option value="file">File</option>
                                      <option value="dir">Folder</option>
                                  </select>
                                  <Input
                                      :model-value="entry.value"
                                      class="flex-1"
                                      placeholder="e.g. **/.env or node_modules/.cache"
                                      @update:model-value="(val: string) => updateExcludeEntry(index, { value: val })"
                                      @blur="() => normalizeExcludeEntry(index)"
                                  />
                                  <Button
                                      variant="ghost"
                                      size="icon"
                                      type="button"
                                      class="text-muted-foreground hover:text-destructive"
                                      @click="removeExcludeEntry(index)"
                                  >
                                      <Trash2 class="size-4" />
                                  </Button>
                              </div>
                          </div>
                          <p v-else class="text-xs text-muted-foreground italic">No exclude rules defined.</p>
                      </div>
                  </div>
               </div>

               <div>
                  <h3 class="text-sm font-medium mb-3">Hooks</h3>
                  <div class="space-y-4">
                      <StringListInput 
                          v-model="gtrConfigDraft.hooks.postCreate" 
                          label="Post Create Commands" 
                          placeholder="e.g. npm install" 
                          help-text="Add multiple commands with commas or new lines."
                      />
                  </div>
               </div>
            </div>
        </div>

        <!-- Auto Configuration Section -->
        <div class="mt-6 border rounded-lg p-4 bg-card/60">
            <h2 class="text-lg font-semibold mb-4">Auto Configuration</h2>
            <p class="text-sm text-muted-foreground mb-4">
              Configure automated project startup. Define how the development server launches and when it's ready.
            </p>

            <div class="space-y-4">
               <div>
                  <label class="text-sm font-medium mb-2 block">Configuration (JSON)</label>
                  <Textarea 
                      v-model="autoConfigJsonDraft"
                      placeholder='{
  "type": "web",
  "startCommand": "pnpm run dev",
  "services": [{ "name": "App", "envKey": "PORT", "default": 3000, "argument": "--port" }],
  "readiness": { "logPattern": "Ready in" }
}'
                      class="font-mono text-sm min-h-[200px] leading-relaxed"
                      :class="{ 'border-destructive': autoConfigParseError }"
                  />
                  <p v-if="autoConfigParseError" class="text-sm text-destructive mt-1">
                    {{ autoConfigParseError }}
                  </p>
               </div>

               <div class="bg-muted/30 rounded-md p-4 text-sm space-y-3">
                  <h4 class="font-medium">Configuration Reference</h4>
                  <div class="grid gap-2 text-muted-foreground">
                     <div><code class="text-foreground">type</code>: <code>"web"</code> (opens browser) or <code>"other"</code> (Electron, Android, CLI)</div>
                     <div><code class="text-foreground">startCommand</code>: Startup command (e.g., <code>"pnpm run dev"</code>)</div>
                     <div><code class="text-foreground">services</code>: Array of service configs with <code>name</code>, <code>envKey</code>, <code>default</code> port, and optional <code>argument</code> for CLI port injection</div>
                     <div><code class="text-foreground">readiness.logPattern</code>: Regex to detect when server is ready</div>
                  </div>
                  
                  <details class="mt-3">
                     <summary class="cursor-pointer text-muted-foreground hover:text-foreground">Examples</summary>
                     <div class="mt-2 space-y-2 pl-4">
                        <div>
                           <span class="font-medium">Next.js:</span>
                           <code class="block bg-background p-2 rounded mt-1 text-xs">{"type": "web", "startCommand": "pnpm run dev", "services": [{"name": "App", "envKey": "PORT", "default": 3000, "argument": "--port"}], "readiness": {"logPattern": "Ready in"}}</code>
                        </div>
                        <div>
                           <span class="font-medium">Vite:</span>
                           <code class="block bg-background p-2 rounded mt-1 text-xs">{"type": "web", "startCommand": "pnpm run dev", "services": [{"name": "App", "envKey": "PORT", "default": 5173, "argument": "--port"}], "readiness": {"logPattern": "Local:"}}</code>
                        </div>
                        <div>
                           <span class="font-medium">Electron:</span>
                           <code class="block bg-background p-2 rounded mt-1 text-xs">{"type": "other", "startCommand": "pnpm run dev", "services": [{"name": "API", "envKey": "API_PORT", "default": 3000}], "readiness": {"logPattern": "Electron app ready"}}</code>
                        </div>
                     </div>
                  </details>
               </div>
            </div>
        </div>
      </div>
    </Transition>

    <!-- Floating Save Bar -->
    <Transition name="slide-up">
        <div v-if="isSettingsDirty" class="fixed bottom-6 right-6 z-50 flex gap-2">
            <div class="bg-popover text-popover-foreground border shadow-lg rounded-lg p-2 flex items-center gap-2">
                <span class="text-sm font-medium px-2 text-muted-foreground">Unsaved changes</span>
                <Button variant="ghost" size="sm" @click="resetSettings" :disabled="isSavingProject">Discard</Button>
                <Button size="sm" @click="saveProjectSettings" :disabled="isSavingProject || !nameDraft.trim()">
                    {{ isSavingProject ? 'Saving...' : 'Save All Changes' }}
                </Button>
            </div>
        </div>
    </Transition>
  </div>
</template>

<style scoped>
.slide-up-enter-active,
.slide-up-leave-active {
  transition: all 0.3s ease;
}

.slide-up-enter-from,
.slide-up-leave-to {
  transform: translateY(20px);
  opacity: 0;
}
</style>
