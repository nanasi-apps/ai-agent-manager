import { getSessionMcpServersLogic } from "@agent-manager/shared";
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

		// Inject API keys if present in process.env
		if (process.env.GEMINI_API_KEY) {
			env.GEMINI_API_KEY = process.env.GEMINI_API_KEY;
		}
		if (process.env.OPENAI_API_KEY) {
			env.OPENAI_API_KEY = process.env.OPENAI_API_KEY;
		}
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
