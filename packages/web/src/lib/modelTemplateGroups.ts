import type { ModelTemplate } from "@/stores/conversation";
import type { ModelProvider } from "@/stores/settings";

export interface ModelTemplateGroup {
	agentType: string;
	isCustomApi: boolean;
	providerId?: string;
	label: string;
	models: ModelTemplate[];
}

interface GroupOptions {
	codexLabel?: string;
	providers?: ModelProvider[];
}

const getGroupLabel = (template: ModelTemplate, options?: GroupOptions) => {
	let base = template.agentName || template.agentType;
	if (options?.codexLabel && template.agentType === "codex") {
		base = options.codexLabel;
	}

	if (template.providerId && options?.providers) {
		const provider = options.providers.find(
			(p) => p.id === template.providerId,
		);
		if (provider) {
			// Avoid duplication if the backend-provided name already includes the provider name
			if (base.includes(provider.name)) {
				return base;
			}
			return `${base} - ${provider.name}`;
		}
	}
	return base;
};

const isCustomApiTemplate = (template: ModelTemplate) =>
	template.name.includes("Custom API");

export const groupModelTemplates = (
	templates: ModelTemplate[],
	options?: GroupOptions,
): ModelTemplateGroup[] => {
	const groups: ModelTemplateGroup[] = [];
	const byGroupKey = new Map<string, ModelTemplateGroup>();

	for (const template of templates) {
		const customApi = isCustomApiTemplate(template);
		// Group by agentType AND providerId
		// Treat undefined providerId as 'default'
		const providerId = template.providerId || "default";
		const groupKey = `${template.agentType}:${customApi ? "custom" : "default"}:${providerId}`;

		let group = byGroupKey.get(groupKey);
		if (!group) {
			const baseLabel = getGroupLabel(template, options);
			group = {
				agentType: template.agentType,
				isCustomApi: customApi,
				providerId: template.providerId,
				label: customApi ? `${baseLabel} - Custom API` : baseLabel,
				models: [],
			};
			byGroupKey.set(groupKey, group);
			groups.push(group);
		}
		group.models.push(template);
	}

	return groups;
};
