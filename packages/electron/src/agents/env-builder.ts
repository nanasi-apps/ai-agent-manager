import { getSessionMcpServersLogic, HARDCODED_MODELS } from "@agent-manager/shared";
import { store } from "../store";
import { getEnhancedEnv } from "../utils/path-enhancer";
import type { SessionState } from "./types";

/**
 * Builds the environment variables for agent processes.
 */
export class EnvBuilder {
	/**
	 * Prepare environment variables for the agent process.
	 */
	static async build(
		state: SessionState,
		mcpServerUrl: string,
		options: {
			isGemini: boolean;
			isCodex: boolean;
			isClaude: boolean;
		},
	): Promise<NodeJS.ProcessEnv> {
		const env = { ...getEnhancedEnv() };

		// Base env vars
		env.MCP_SERVER_URL = mcpServerUrl;
		env.AGENT_SESSION_ID = state.sessionId;

		// Add custom environment variables from config
		if (state.config.env) {
			Object.assign(env, state.config.env);
		}

		// Inject API keys and Base URLs from Store settings
		// ONLY if using a Custom Model (one that is not in the hardcoded list)
		// This prevents overriding standard CLI auth/config for standard models
		const apiSettings = store.getApiSettings();
		const currentModel = state.config.model;
		const configType = state.config.type; // gemini, codex, etc.

		// Check if the model is "standard" (hardcoded)
		// If configType is unknown or model is missing, we assume it might be custom or rely on defaults
		// But here the user specifically wants to inject "only when custom model is selected".
		// We define "Custom Model" as: NOT in HARDCODED_MODELS for that type.
		let isStandardModel = false;
		if (configType && currentModel && HARDCODED_MODELS[configType]) {
			isStandardModel = HARDCODED_MODELS[configType].includes(currentModel);
		}

		// Gemini
		// Inject if NOT standard model (i.e. Custom)
		if (options.isGemini && !isStandardModel) {
			if (apiSettings.geminiApiKey) {
				env.GEMINI_API_KEY = apiSettings.geminiApiKey;
			}
			if (apiSettings.geminiBaseUrl) {
				env.GEMINI_BASE_URL = apiSettings.geminiBaseUrl;
				env.GOOGLE_GENAI_BASE_URL = apiSettings.geminiBaseUrl;
				env.API_BASE = apiSettings.geminiBaseUrl;
				env.GEMINI_API_BASE = apiSettings.geminiBaseUrl;
			}
		}

		// OpenAI / Codex
		if (options.isCodex && !isStandardModel) {
			if (apiSettings.openaiApiKey) {
				env.OPENAI_API_KEY = apiSettings.openaiApiKey;
			}
			if (apiSettings.openaiBaseUrl) {
				env.OPENAI_BASE_URL = apiSettings.openaiBaseUrl;
			}
		}

		// Anthropic
		if (process.env.ANTHROPIC_API_KEY) {
			env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
		}

		// Configure MCP servers based on user settings
		// We use the shared logic to get the configured servers for this projectId
		if (state.config.cwd) {
			const mcpConfig = await getSessionMcpServersLogic(state.sessionId);
			if (mcpConfig) {
				const serverNames = [
					...mcpConfig.sessionServers,
					...mcpConfig.globalServers,
				].map((s) => s.name);

				if (serverNames.length > 0) {
					console.log(
						`[EnvBuilder] Configuring MCP servers: ${serverNames.join(", ")}`,
					);

					// For Gemini CLI
					if (options.isGemini) {
						// Pass the config file path directly to the CLI if possible,
						// or set env vars that the CLI expects.
						// The Gemini CLI usually expects a config file.
						// Assuming standard mcp.json location for now or relying on CLI's auto-discovery
						// If specific env vars are needed for dynamic MCP registration, add them here.
					}
				}
			}
		}

		return env;
	}
}
