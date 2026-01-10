/**
 * Model Fetcher - Utilities for AI models
 *
 * MIGRATION STATUS (Milestone 4):
 * - Pure utilities (MODEL_ID_SEPARATOR, buildModelId, parseModelId, etc.) STAY HERE
 * - Implementation code has been moved to electron/application/services/model-fetcher.ts
 */

import type { ModelTemplate } from "../types/project";

// ============================================================================
// PURE UTILITIES - These stay in shared (no side effects, no state)
// ============================================================================

export const MODEL_ID_SEPARATOR = "::";
export const MODEL_CACHE_TTL_MS = 60_000;

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

export function buildModelId(agentType: string, model?: string): string {
	return `${agentType}${MODEL_ID_SEPARATOR}${model ?? ""}`;
}

export function parseModelId(
	modelId: string,
): { agentType: string; model?: string; providerId?: string } | null {
	if (!modelId) return null;
	const parts = modelId.split(MODEL_ID_SEPARATOR);

	// Handle legacy/simple format: "agentType" or "agentType::model"
	if (parts.length <= 2) {
		const agentType = parts[0];
		if (!agentType) return null;
		return { agentType, model: parts[1] || undefined };
	}

	// Handle format with provider: "agentType::model::providerId"
	// We assume the LAST part is providerId if there are 3 or more parts,
	// BUT we need to be careful if model name itself contains "::"
	const agentType = parts[0];
	if (!agentType) return null;
	const providerId = parts[parts.length - 1];
	const model = parts.slice(1, -1).join(MODEL_ID_SEPARATOR);

	return {
		agentType,
		model: model || undefined,
		providerId: providerId || undefined,
	};
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
	return !(HARDCODED_MODELS.codex ?? []).includes(model);
}
