import * as fs from "fs/promises";
import { homedir } from "os";
import * as path from "path";

export interface GeminiEnvOptions {
	mcpServerUrl: string;
	existingHome?: string;
	apiKey?: string;
	baseUrl?: string;
	mode?: "regular" | "plan" | "ask";
}

export async function prepareGeminiEnv(
	options: GeminiEnvOptions,
): Promise<NodeJS.ProcessEnv> {
	const { mcpServerUrl, existingHome, apiKey, baseUrl } = options;
	const env: NodeJS.ProcessEnv = {};

	// Set API key if provided
	if (apiKey) {
		env.GEMINI_API_KEY = apiKey;
		console.log("[EnvUtils] Setting GEMINI_API_KEY for Gemini CLI");
	}

	// Set custom base URL if provided
	if (baseUrl) {
		env.GOOGLE_GEMINI_BASE_URL = baseUrl;
		console.log(`[EnvUtils] Setting GOOGLE_GEMINI_BASE_URL: ${baseUrl}`);
	}

	try {
		const { tmpdir } = await import("os");
		if (existingHome) {
			await ensureGeminiSettings(
				existingHome,
				mcpServerUrl,
				options.mode,
				false,
				!!apiKey,
			);
			return { ...env, HOME: existingHome };
		}

		const uniqueId = Math.random().toString(36).substring(7);
		const tempHome = path.join(tmpdir(), `agent-manager-gemini-${uniqueId}`);
		await ensureGeminiSettings(
			tempHome,
			mcpServerUrl,
			options.mode,
			true,
			!!apiKey,
		);

		return { ...env, HOME: tempHome };
	} catch (error) {
		console.error("[EnvUtils] Failed to prepare Gemini temp env:", error);
		return env;
	}
}

export async function prepareClaudeEnv(
	mcpServerUrl: string,
	existingConfigDir?: string,
): Promise<NodeJS.ProcessEnv> {
	try {
		const { tmpdir } = await import("os");
		if (existingConfigDir) {
			await ensureClaudeSettings(existingConfigDir, mcpServerUrl, false);
			return { CLAUDE_CONFIG_DIR: existingConfigDir };
		}

		const uniqueId = Math.random().toString(36).substring(7);
		const tempConfigDir = path.join(
			tmpdir(),
			`agent-manager-claude-${uniqueId}`,
		);
		await ensureClaudeSettings(tempConfigDir, mcpServerUrl, true);

		return { CLAUDE_CONFIG_DIR: tempConfigDir };
	} catch (error) {
		console.error("[EnvUtils] Failed to prepare Claude temp env:", error);
		return {};
	}
}

export interface CodexEnvOptions {
	apiKey?: string;
	baseUrl?: string;
}

/**
 * Prepare environment variables for Codex CLI
 * - OPENAI_API_KEY: API key for OpenAI authentication
 * - OPENAI_BASE_URL: Custom base URL for API endpoint (e.g., Azure OpenAI)
 */
export function prepareCodexEnv(options: CodexEnvOptions): NodeJS.ProcessEnv {
	const { apiKey, baseUrl } = options;
	const env: NodeJS.ProcessEnv = {};

	if (apiKey) {
		env.OPENAI_API_KEY = apiKey;
		console.log("[EnvUtils] Setting OPENAI_API_KEY for Codex CLI");
	}

	if (baseUrl) {
		env.OPENAI_BASE_URL = baseUrl;
		console.log(`[EnvUtils] Setting OPENAI_BASE_URL: ${baseUrl}`);
	}

	return env;
}

async function ensureGeminiSettings(
	homeDir: string,
	mcpServerUrl: string,
	mode: "regular" | "plan" | "ask" | undefined,
	copyAuth: boolean,
	useApiKey: boolean = false,
): Promise<void> {
	const settingsDir = path.join(homeDir, ".gemini");
	const settingsFile = path.join(settingsDir, "settings.json");

	await fs.mkdir(settingsDir, { recursive: true });

	if (copyAuth) {
		const userHome = homedir();
		const userGeminiDir = path.join(userHome, ".gemini");

		const filesToCopy = [
			"oauth_creds.json",
			"google_accounts.json",
			"installation_id",
			"state.json",
			"settings.json",
		];

		for (const file of filesToCopy) {
			try {
				await fs.copyFile(
					path.join(userGeminiDir, file),
					path.join(settingsDir, file),
				);
			} catch (e) {
				// File might not exist, ignore
			}
		}
	}

	interface GeminiSettings {
		mcpServers?: Record<string, { url: string }>;
		security?: {
			auth?: {
				selectedType?: string;
			};
		};
		tools?: {
			exclude?: string[];
		};
	}

	let settings: GeminiSettings = { mcpServers: {} };
	try {
		const content = await fs.readFile(settingsFile, "utf-8");
		settings = JSON.parse(content) as GeminiSettings;
	} catch (e) {
		// If it wasn't there or invalid, we start with empty settings
	}

	// Configure MCP servers
	if (!settings.mcpServers) settings.mcpServers = {};
	settings.mcpServers["agents-manager-mcp"] = { url: mcpServerUrl };

	// When using API key, configure security settings for Gemini CLI
	// Note: 'oauth-personal' is required for using custom models in one-shot mode
	if (useApiKey) {
		if (!settings.security) settings.security = {};
		if (!settings.security.auth) settings.security.auth = {};
		settings.security.auth.selectedType = "gemini-api-key";
		console.log(
			"[EnvUtils] Configured Gemini security.auth.selectedType = gemini-api-key",
		);
	}

	// Plan or Ask mode: exclude prohibited tools (cognitive control)
	if (mode === "plan" || mode === "ask") {
		if (!settings.tools) settings.tools = {};
		settings.tools.exclude = [
			...(settings.tools.exclude || []),
			"googleSearch",
			"codeExecution",
		];
		console.log(
			`[EnvUtils] ${mode} Mode: excluding googleSearch, codeExecution in settings.json`,
		);
	}

	await fs.writeFile(settingsFile, JSON.stringify(settings, null, 2));
}

async function ensureClaudeSettings(
	configDir: string,
	mcpServerUrl: string,
	copyAuth: boolean,
): Promise<void> {
	const settingsFile = path.join(configDir, "config.json");

	await fs.mkdir(configDir, { recursive: true });

	if (copyAuth) {
		const userHome = homedir();
		// Claude Code config location on macOS
		let sourceDir = path.join(
			userHome,
			"Library",
			"Application Support",
			"claude-code",
		);
		if (process.platform === "win32") {
			sourceDir = path.join(process.env.APPDATA || "", "claude-code");
		} else if (process.platform === "linux") {
			sourceDir = path.join(userHome, ".config", "claude-code");
		}

		const filesToCopy = ["config.json", "auth.json"];

		for (const file of filesToCopy) {
			try {
				await fs.copyFile(
					path.join(sourceDir, file),
					path.join(configDir, file),
				);
			} catch (e) {
				// File might not exist, ignore
			}
		}
	}

	interface ClaudeSettings {
		mcpServers?: Record<string, { type: string; url: string }>;
	}

	let settings: ClaudeSettings = { mcpServers: {} };
	try {
		const content = await fs.readFile(settingsFile, "utf-8");
		settings = JSON.parse(content) as ClaudeSettings;
	} catch (e) {
		// If it wasn't there or invalid, we start with empty settings
	}

	if (!settings.mcpServers) settings.mcpServers = {};
	// Claude Code MCP format for SSE
	settings.mcpServers["agents-manager-mcp"] = {
		type: "sse",
		url: mcpServerUrl,
	};

	await fs.writeFile(settingsFile, JSON.stringify(settings, null, 2));
}
