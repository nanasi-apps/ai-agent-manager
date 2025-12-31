import type { ModelTemplate } from "@/composables/useConversation";

export interface ModelTemplateGroup {
	agentType: string;
	isCustomApi: boolean;
	label: string;
	models: ModelTemplate[];
}

interface GroupOptions {
	codexLabel?: string;
}

const getGroupLabel = (template: ModelTemplate, options?: GroupOptions) => {
	if (options?.codexLabel && template.agentType === "codex") {
		return options.codexLabel;
	}
	return template.agentName || template.agentType;
};

const isCustomApiTemplate = (template: ModelTemplate) =>
	template.name.includes("Custom API");

export const groupModelTemplates = (
	templates: ModelTemplate[],
	options?: GroupOptions,
): ModelTemplateGroup[] => {
	const groups: ModelTemplateGroup[] = [];
	const byAgentType = new Map<string, ModelTemplateGroup>();

	for (const template of templates) {
		const customApi = isCustomApiTemplate(template);
		const groupKey = `${template.agentType}:${customApi ? "custom" : "default"}`;
		let group = byAgentType.get(groupKey);
		if (!group) {
			const baseLabel = getGroupLabel(template, options);
			group = {
				agentType: template.agentType,
				isCustomApi: customApi,
				label: customApi ? `${baseLabel} - Custom API` : baseLabel,
				models: [],
			};
			byAgentType.set(groupKey, group);
			groups.push(group);
		}
		group.models.push(template);
	}

	return groups;
};
