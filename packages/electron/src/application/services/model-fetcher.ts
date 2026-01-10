/**
 * ModelFetcher - Implementation of IModelFetcher
 *
 * This service handles fetching AI model lists from various providers.
 * It includes caching to avoid excessive API calls.
 *
 * Part of Milestone 4: Move shared/services into electron
 */

import type { IModelFetcher } from "@agent-manager/shared";
import {
	HARDCODED_MODELS,
	MODEL_CACHE_TTL_MS,
	withTimeout,
} from "@agent-manager/shared";
import { GoogleGenAI, type GoogleGenAIOptions } from "@google/genai";
import OpenAI from "openai";

const MODEL_FETCH_TIMEOUT_MS = 10000; // 10 seconds

/**
 * Model cache entry - stores model IDs with expiry
 */
interface ModelCacheEntry {
	expiresAt: number;
	models: string[];
}

/**
 * Creates a ModelFetcher service instance
 *
 * @returns IModelFetcher implementation
 */
export function createModelFetcher(): IModelFetcher {
	// Model list cache - stores fetched model IDs with expiry
	const modelListCache = new Map<string, ModelCacheEntry>();

	/**
	 * Fetch available models from OpenAI-compatible API
	 * Works with OpenAI, Azure, DeepSeek, and other compatible endpoints
	 */
	async function fetchOpenAIModels(
		apiKey: string,
		baseUrl?: string,
	): Promise<string[]> {
		// Use codex hardcoded models as fallback for standard OpenAI
		// For custom endpoints, we want to return what the API provides
		const isCustomEndpoint = baseUrl && !baseUrl.includes("openai.com");
		const fallback = isCustomEndpoint ? [] : (HARDCODED_MODELS.codex ?? []);

		const fetchModels = async (): Promise<string[]> => {
			console.log(
				`[fetchOpenAIModels] Fetching models${baseUrl ? ` from: ${baseUrl}` : ""}`,
			);
			const client = new OpenAI({
				apiKey,
				baseURL: baseUrl,
				timeout: MODEL_FETCH_TIMEOUT_MS,
			});

			const response = await client.models.list();
			const models: string[] = [];

			for await (const model of response) {
				models.push(model.id);
			}

			// Sort alphabetically, with common prefixes grouped
			models.sort((a, b) => a.localeCompare(b));

			return models.length > 0 ? models : fallback;
		};

		try {
			const result = await withTimeout(
				fetchModels(),
				MODEL_FETCH_TIMEOUT_MS,
				fallback,
			);
			// For custom endpoints, if we got models but timeout/fallback returned empty, try to be helpful
			if (result.length === 0 && isCustomEndpoint) {
				console.warn(
					"[fetchOpenAIModels] No models found from custom endpoint, will show empty list",
				);
			}
			return result;
		} catch (error) {
			console.error("[fetchOpenAIModels] Error fetching models:", error);
			return fallback;
		}
	}

	/**
	 * Fetch available models from Gemini API using SDK
	 */
	async function fetchGeminiModels(
		apiKey: string,
		baseUrl?: string,
	): Promise<string[]> {
		const fallback = HARDCODED_MODELS.gemini ?? [];

		const fetchModels = async (): Promise<string[]> => {
			console.log(
				`[fetchGeminiModels] Fetching models${baseUrl ? ` from: ${baseUrl}` : ""}`,
			);

			const clientOptions: GoogleGenAIOptions = {
				apiKey,
				httpOptions: { timeout: MODEL_FETCH_TIMEOUT_MS },
			};
			if (baseUrl) {
				clientOptions.httpOptions = { ...clientOptions.httpOptions, baseUrl };
			}
			console.log(
				"[fetchGeminiModels] Client options:",
				JSON.stringify(clientOptions, null, 2),
			);
			const client = new GoogleGenAI(clientOptions);
			const response = await client.models.list();
			console.log("[fetchGeminiModels] Got response");
			const models: string[] = [];

			for await (const model of response) {
				if (model.supportedActions?.includes("generateContent") && model.name) {
					models.push(model.name.replace("models/", ""));
				}
			}

			// Sort newer models first (2.5 > 2.0 > 1.5)
			models.sort((a, b) => {
				const getVersion = (s: string) => {
					const match = s.match(/gemini-(\d+\.?\d*)/);
					return match?.[1] ? parseFloat(match[1]) : 0;
				};
				return getVersion(b) - getVersion(a);
			});

			return models.length > 0 ? models : fallback;
		};

		try {
			return await withTimeout(fetchModels(), MODEL_FETCH_TIMEOUT_MS, fallback);
		} catch (error) {
			console.error("[fetchGeminiModels] Error fetching models:", error);
			return fallback;
		}
	}

	/**
	 * Clear all cached models
	 */
	function clearCache(): void {
		modelListCache.clear();
		console.log("[ModelFetcher] Cache cleared");
	}

	/**
	 * Get cached models if available and not expired
	 */
	function getCachedModels(cacheKey: string): string[] | undefined {
		const cached = modelListCache.get(cacheKey);
		if (cached && cached.expiresAt > Date.now()) {
			return cached.models;
		}
		return undefined;
	}

	/**
	 * Set cached models with TTL
	 */
	function setCachedModels(cacheKey: string, models: string[]): void {
		modelListCache.set(cacheKey, {
			expiresAt: Date.now() + MODEL_CACHE_TTL_MS,
			models: models,
		});
	}

	return {
		fetchOpenAIModels,
		fetchGeminiModels,
		clearCache,
		getCachedModels,
		setCachedModels,
	};
}

/**
 * Legacy exports for gradual migration
 *
 * @deprecated Use createModelFetcher() instead
 */
export const modelFetcherService = createModelFetcher();
