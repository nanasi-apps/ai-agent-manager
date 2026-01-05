import { os } from "@orpc/server";
import { z } from "zod";
import { getStoreOrThrow } from "../services/dependency-container";
import {
	buildModelId,
	fetchGeminiModels,
	fetchOpenAIModels,
	getModelsForCliType,
	MODEL_CACHE_TTL_MS,
	modelListCache,
} from "../services/model-fetcher";
import type { ModelTemplate } from "../types/project";
import { availableAgents } from "../types/project";

export const modelsRouter = {
	listAgentTemplates: os
		.output(
			z.array(
				z.object({
					id: z.string(),
					name: z.string(),
				}),
			),
		)
		.handler(async () => {
			return availableAgents.map((a) => ({
				id: a.id,
				name: a.name,
			}));
		}),

	listModelTemplates: os
		.input(z.object({ includeDisabled: z.boolean().optional() }).optional())
		.output(
			z.array(
				z.object({
					id: z.string(),
					name: z.string(),
					agentType: z.string(),
					agentName: z.string(),
					model: z.string().optional(),
					providerId: z.string().optional(),
				}),
			),
		)
		.handler(async ({ input }) => {
			const storeInstance = getStoreOrThrow();
			const apiSettings = storeInstance.getApiSettings();
			// Use configured providers list
			const providers = apiSettings.providers || [];
			const includeDisabled = input?.includeDisabled ?? false;

			// Create a cache key based on providers configuration AND includeDisabled flag
			// Hash disabledModels too
			const cacheKey = `models:v2:${includeDisabled}:${JSON.stringify(providers.map(p => ({
				id: p.id,
				type: p.type,
				baseUrl: p.baseUrl,
				apiKey: p.apiKey ? 'set' : 'unset',
				disabledModels: p.disabledModels
			})))}`;
			const cached = modelListCache.get(cacheKey);
			const now = Date.now();
			if (cached && cached.expiresAt > now) {
				return cached.models;
			}

			const results: ModelTemplate[] = [];

			// 1. Add Default/Hardcoded Models for each CLI Agent Type
			for (const agent of availableAgents) {
				const agentType = agent.id;
				const agentName = agent.name;
				const cliType = agent.agent.type;

				const hardcodedModels = getModelsForCliType(cliType);
				if (hardcodedModels.length > 0) {
					for (const model of hardcodedModels) {
						results.push({
							id: buildModelId(agentType, model),
							name: model,
							agentType,
							agentName, // e.g. "OpenAI Codex"
							model,
						});
					}
				} else if (cliType !== "cat") {
					if (hardcodedModels.length === 0) {
						const defaultName = agentName;
						results.push({
							id: buildModelId(agentType),
							name: defaultName,
							agentType,
							agentName: defaultName,
						});
					}
				} else {
					// cat agent
					results.push({
						id: buildModelId(agentType),
						name: agentName,
						agentType,
						agentName,
					});
				}
			}

			// 2. Add Models from Configured Providers
			for (const provider of providers) {
				let targetAgentId = "";
				if (provider.type === "gemini") targetAgentId = "gemini";
				// 'openai' and 'openai_compatible' map to 'codex' driver
				else if (["codex", "openai", "openai_compatible"].includes(provider.type)) targetAgentId = "codex";

				const agentTemplate = availableAgents.find((a) => a.id === targetAgentId);
				if (!agentTemplate) continue;

				let models: string[] = [];
				const apiKey = provider.apiKey;

				try {
					if (provider.type === "gemini" && apiKey) {
						models = await fetchGeminiModels(apiKey, provider.baseUrl);
					} else if (["codex", "openai", "openai_compatible"].includes(provider.type)) {
						const p = provider as any;
						if (apiKey) {
							models = await fetchOpenAIModels(apiKey, p.baseUrl);
						}
					}
				} catch (e) {
					console.error(`Failed to fetch models for provider ${provider.name}`, e);
				}

				if (models.length > 0) {
					const groupName = `${agentTemplate.name} - ${provider.name}`;
					const disabledModels = provider.disabledModels || [];

					for (const model of models) {
						// Filter out disabled models unless requested
						if (!includeDisabled && disabledModels.includes(model)) {
							continue;
						}

						results.push({
							id: `${buildModelId(targetAgentId, model)}::${provider.id}`,
							name: model,
							agentType: targetAgentId,
							agentName: groupName,
							model,
							providerId: provider.id,
						});
					}
				}
			}

			// Sort: Group by AgentName, then Model Name
			results.sort((a, b) => {
				const nameCompare = a.agentName.localeCompare(b.agentName);
				if (nameCompare !== 0) return nameCompare;
				return (a.model || "").localeCompare(b.model || "");
			});

			modelListCache.set(cacheKey, {
				expiresAt: now + MODEL_CACHE_TTL_MS,
				models: results,
			});

			return results;
		}),
};
