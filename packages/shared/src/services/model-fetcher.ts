import { GoogleGenAI, type GoogleGenAIOptions } from "@google/genai";
import OpenAI from "openai";
import type { ModelTemplate } from "../types/project";
import { withTimeout } from "../utils";

export const MODEL_ID_SEPARATOR = "::";
export const MODEL_CACHE_TTL_MS = 60_000;
const MODEL_FETCH_TIMEOUT_MS = 10000; // 10 seconds

// Hardcoded model lists for each CLI type
// Dynamic detection is unreliable due to authentication, permission dialogs, and CLI quirks
export const HARDCODED_MODELS: Record<string, string[]> = {
	gemini: [
		"gemini-3-pro-preview",
		"gemini-3-flash-preview",
		"gemini-2.5-pro",
		"gemini-2.5-flash",
		"gemini-2.5-flash-lite",
	],
	claude: ["claude-sonnet-4.5", "claude-opus-4.5", "claude-haiku-4.5"],
	codex: [
		"gpt-5.2-codex",
		"gpt-5.1-codex-max",
		"gpt-5.1-codex-mini",
		"gpt-5.2",
	],
};

export const modelListCache = new Map<
	string,
	{ expiresAt: number; models: ModelTemplate[] }
>();

export function buildModelId(agentType: string, model?: string): string {
	return `${agentType}${MODEL_ID_SEPARATOR}${model ?? ""}`;
}

export function parseModelId(
	modelId: string,
): { agentType: string; model?: string } | null {
	if (!modelId) return null;
	const [agentType, ...rest] = modelId.split(MODEL_ID_SEPARATOR);
	if (!agentType) return null;
	const model = rest.join(MODEL_ID_SEPARATOR);
	return { agentType, model: model || undefined };
}

export function getModelsForCliType(cliType: string): string[] {
	return HARDCODED_MODELS[cliType] ?? [];
}

export function shouldUseOpenAIBaseUrl(
	model?: string,
	baseUrl?: string,
): boolean {
	if (!baseUrl) return false;
	const isCustomEndpoint = !baseUrl.includes("openai.com");
	if (!isCustomEndpoint) return true;
	if (!model) return true;
	return !(HARDCODED_MODELS["codex"] ?? []).includes(model);
}

/**
 * Fetch available models from OpenAI-compatible API
 * Works with OpenAI, Azure, DeepSeek, and other compatible endpoints
 */
export async function fetchOpenAIModels(
	apiKey: string,
	baseUrl?: string,
): Promise<string[]> {
	// Use codex hardcoded models as fallback for standard OpenAI
	// For custom endpoints, we want to return what the API provides
	const isCustomEndpoint = baseUrl && !baseUrl.includes("openai.com");
	const fallback = isCustomEndpoint ? [] : (HARDCODED_MODELS["codex"] ?? []);

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
export async function fetchGeminiModels(
	apiKey: string,
	baseUrl?: string,
): Promise<string[]> {
	const fallback = HARDCODED_MODELS["gemini"] ?? [];

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
				return match && match[1] ? parseFloat(match[1]) : 0;
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
