import { getSessionMcpServersLogic, HARDCODED_MODELS, ModelProviderCodex } from "@agent-manager/shared";
import { store } from "../store/file-store";
import { getEnhancedEnv } from "../utils/path-enhancer";
import { prepareClaudeEnv, prepareGeminiEnv } from "./env-utils";
import type { SessionState } from "./types";

/**
 * Builds the environment variables for agent processes.
 */
export const EnvBuilder = {
	/**
	 * Prepare environment variables for the agent process.
	 */
	async build(
		state: SessionState,
		mcpServerUrl: string,
		options: {
			isGemini: boolean;
			isCodex: boolean;
			isClaude: boolean;
			mode?: "regular" | "plan" | "ask";
		},
	): Promise<{
		env: NodeJS.ProcessEnv;
		geminiHome?: string;
		claudeHome?: string;
	}> {
		const env = { ...getEnhancedEnv() };

		// Base env vars
		env.MCP_SERVER_URL = mcpServerUrl;
		env.AGENT_SESSION_ID = state.sessionId;

		// Add custom environment variables from config
		if (state.config.env) {
			Object.assign(env, state.config.env);
		}

		// Inject API keys and Base URLs from Store settings
		// Codex uses custom settings only for non-hardcoded models.
		// Gemini honors API settings when an API key is configured.
		const apiSettings = store.getApiSettings();
		const currentModel = state.config.model;
		const configType = state.config.type; // gemini, codex, etc.

		// Check if the model is "standard" (hardcoded)
		let isStandardModel = false;
		if (configType && currentModel && HARDCODED_MODELS[configType]) {
			isStandardModel = HARDCODED_MODELS[configType].includes(currentModel);
		}

		// Find relevant providers
		const providers = apiSettings.providers || [];

		let geminiProvider = providers.find((p) => p.type === "gemini");
		let openaiProvider = providers.find(
			(p) => p.type === "openai" || p.type === "openai_compatible" || p.type === "codex",
		) as ModelProviderCodex;

		// If a specific provider is configured (Custom API), use it
		if (state.config.provider) {
			const activeProvider = providers.find(
				(p) => p.id === state.config.provider,
			);
			if (activeProvider) {
				if (activeProvider.type === "gemini") {
					geminiProvider = activeProvider;
				} else if (
					activeProvider.type === "openai" ||
					activeProvider.type === "openai_compatible" ||
					activeProvider.type === "codex"
				) {
					openaiProvider = activeProvider as ModelProviderCodex;
				}
			}
		}

		// Gemini
		let geminiHome: string | undefined;
		if (options.isGemini) {
			// Use prepareGeminiEnv to set up the environment directory and settings
			const geminiEnv = await prepareGeminiEnv({
				mcpServerUrl,
				existingHome: state.geminiHome,
				apiKey: geminiProvider?.apiKey,
				baseUrl: geminiProvider?.baseUrl,
				mode: options.mode,
			});
			Object.assign(env, geminiEnv);
			if (geminiEnv.HOME) {
				geminiHome = geminiEnv.HOME;
			}
		}

		// Claude
		let claudeHome: string | undefined;
		if (options.isClaude) {
			const claudeEnv = await prepareClaudeEnv(
				mcpServerUrl,
				state.claudeHome, // existingConfigDir
			);
			Object.assign(env, claudeEnv);
			if (claudeEnv.CLAUDE_CONFIG_DIR) {
				claudeHome = claudeEnv.CLAUDE_CONFIG_DIR;
			}
		}

		// OpenAI / Codex
		if (options.isCodex && !isStandardModel) {
			console.log("[EnvBuilder] Using custom OpenAI / Codex provider settings");
			console.log("openaiProvider: ",openaiProvider)
			if (openaiProvider) {
				console.log("openaiProvider: ",openaiProvider)
				if (openaiProvider.apiKey && openaiProvider.envKey) {
					console.log("openaiEnvkey: ",openaiProvider.envKey)
					env[openaiProvider.envKey] = openaiProvider.apiKey;
				} else if (openaiProvider.apiKey) {
					env.OPENAI_API_KEY = openaiProvider.apiKey;
				}
			}
		}

		// Anthropic
		if (process.env.ANTHROPIC_API_KEY) {
			env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
		}

		// Logging MCP configuration (Logic moved to prepare*Env mostly, but keeping log for clarity)
		if (state.config.cwd) {
			const mcpConfig = await getSessionMcpServersLogic(state.sessionId);
			if (mcpConfig) {
				const serverNames = [
					...mcpConfig.sessionServers,
					...mcpConfig.globalServers,
				].map((s) => s.name);

				if (serverNames.length > 0) {
					console.log(
						`[EnvBuilder] Active MCP servers: ${serverNames.join(", ")}`,
					);
				}
			}
		}

		return { env, geminiHome, claudeHome };
	},
};
