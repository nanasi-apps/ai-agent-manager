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
		.output(
			z.array(
				z.object({
					id: z.string(),
					name: z.string(),
					agentType: z.string(),
					agentName: z.string(),
					model: z.string().optional(),
				}),
			),
		)
		.handler(async () => {
			const storeInstance = getStoreOrThrow();
			const apiSettings = storeInstance.getApiSettings();

			// Check which API keys are configured
			const hasOpenaiKey = !!apiSettings.openaiApiKey;
			const hasGeminiApiKey = !!apiSettings.geminiApiKey;

			// Skip cache if we need to check API settings dynamically
			const cacheKey = `all:openai=${hasOpenaiKey}:gemini=${hasGeminiApiKey}`;
			const cached = modelListCache.get(cacheKey);
			const now = Date.now();
			if (cached && cached.expiresAt > now) {
				return cached.models;
			}

			const results: ModelTemplate[] = [];

			for (const agent of availableAgents) {
				const agentType = agent.id;
				const agentName = agent.name;
				const cliType = agent.agent.type;

				// For CLI agents with API keys configured, try to fetch models dynamically
				// Otherwise use hardcoded model lists
				let models: string[] = [];
				let isCustomEndpoint = false;

				if (cliType === "codex" && hasOpenaiKey) {
					models = await fetchOpenAIModels(
						apiSettings.openaiApiKey!,
						apiSettings.openaiBaseUrl,
					);
					// Check if using a custom endpoint (not standard OpenAI)
					isCustomEndpoint = !!(
						apiSettings.openaiBaseUrl &&
						!apiSettings.openaiBaseUrl.includes("openai.com")
					);
				} else if (cliType === "gemini" && hasGeminiApiKey) {
					models = await fetchGeminiModels(
						apiSettings.geminiApiKey!,
						apiSettings.geminiBaseUrl,
					);
					// Check if using a custom endpoint (not standard Google)
					isCustomEndpoint = !!(
						apiSettings.geminiBaseUrl &&
						!apiSettings.geminiBaseUrl.includes("googleapis.com") &&
						!apiSettings.geminiBaseUrl.includes("google.com")
					);
				} else {
					models = getModelsForCliType(cliType);
				}

				const modelEntries: { model: string; isCustom: boolean }[] = [];
				if (isCustomEndpoint) {
					const hardcodedModels = getModelsForCliType(cliType);
					const seen = new Set<string>();
					for (const model of hardcodedModels) {
						if (seen.has(model)) continue;
						seen.add(model);
						modelEntries.push({ model, isCustom: false });
					}
					for (const model of models) {
						if (seen.has(model)) continue;
						seen.add(model);
						modelEntries.push({ model, isCustom: true });
					}
				} else {
					for (const model of models) {
						modelEntries.push({ model, isCustom: false });
					}
				}

				// Only add default entry if there are no hardcoded models
				if (modelEntries.length === 0) {
					const defaultName = agentName.toLowerCase().includes("default")
						? agentName
						: `${agentName} (Default)`;
					results.push({
						id: buildModelId(agentType),
						name: defaultName,
						agentType,
						agentName,
					});
				} else {
					// Add all models
					for (const entry of modelEntries) {
						// For custom endpoints, add suffix to show it's from custom API
						const displayName = entry.isCustom
							? `${entry.model} - Custom API (${agentName})`
							: entry.model;

						results.push({
							id: buildModelId(agentType, entry.model),
							name: displayName,
							agentType,
							agentName,
							model: entry.model,
						});
					}
				}
			}

			modelListCache.set(cacheKey, {
				expiresAt: now + MODEL_CACHE_TTL_MS,
				models: results,
			});

			return results;
		}),
};
