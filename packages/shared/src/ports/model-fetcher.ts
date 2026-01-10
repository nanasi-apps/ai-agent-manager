/**
 * IModelFetcher - Port interface for fetching AI model lists
 *
 * This interface defines the contract for fetching available models
 * from various AI providers (OpenAI, Gemini, etc.).
 *
 * Implementation lives in packages/electron where the actual HTTP calls happen.
 */

export interface IModelFetcher {
	/**
	 * Fetch available models from OpenAI-compatible API
	 * Works with OpenAI, Azure, DeepSeek, and other compatible endpoints
	 *
	 * @param apiKey - API key for authentication
	 * @param baseUrl - Optional custom base URL for API endpoint
	 * @returns List of available model IDs
	 */
	fetchOpenAIModels(apiKey: string, baseUrl?: string): Promise<string[]>;

	/**
	 * Fetch available models from Gemini API
	 *
	 * @param apiKey - API key for authentication
	 * @param baseUrl - Optional custom base URL for API endpoint
	 * @returns List of available model IDs
	 */
	fetchGeminiModels(apiKey: string, baseUrl?: string): Promise<string[]>;

	/**
	 * Clear the model list cache
	 * Call this when API settings change
	 */
	clearCache(): void;

	/**
	 * Get cached models for a provider
	 *
	 * @param cacheKey - Cache key (usually provider ID or "default")
	 * @returns Cached models if available and not expired, undefined otherwise
	 */
	getCachedModels(cacheKey: string): string[] | undefined;

	/**
	 * Set cached models for a provider
	 *
	 * @param cacheKey - Cache key (usually provider ID or "default")
	 * @param models - Models to cache
	 */
	setCachedModels(cacheKey: string, models: string[]): void;
}
