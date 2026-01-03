import * as fs from "node:fs/promises";
import { homedir } from "node:os";
import * as path from "node:path";

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
		const { tmpdir } = await import("node:os");
		if (existingHome) {
			// Even when reusing existingHome, ensure OAuth auth files exist if needed
			// This handles the case where we switch from Custom API to OAuth
			if (!apiKey) {
				await ensureOAuthFilesExist(existingHome);
			}
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
		const { tmpdir } = await import("node:os");
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

/**
 * Ensure OAuth auth files exist in the temp Gemini directory.
 * This is needed when switching from Custom API to OAuth authentication.
 */
async function ensureOAuthFilesExist(homeDir: string): Promise<void> {
	const settingsDir = path.join(homeDir, ".gemini");
	const userHome = homedir();
	const userGeminiDir = path.join(userHome, ".gemini");

	// Critical OAuth files that must exist for OAuth authentication
	const authFiles = ["oauth_creds.json", "google_accounts.json"];

	await fs.mkdir(settingsDir, { recursive: true });

	for (const file of authFiles) {
		const targetFile = path.join(settingsDir, file);
		const sourceFile = path.join(userGeminiDir, file);

		try {
			// Check if file already exists in temp dir
			await fs.access(targetFile);
		} catch {
			// File doesn't exist, try to copy from user's home
			try {
				await fs.copyFile(sourceFile, targetFile);
				console.log(`[EnvUtils] Copied missing OAuth file: ${file}`);
			} catch (_e) {
				console.log(`[EnvUtils] Could not copy OAuth file ${file} (may not exist in user home)`);
			}
		}
	}
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
				console.log(`[EnvUtils] Copied ${file} to temp Gemini dir`);
			} catch (_e) {
				// File might not exist, ignore
				console.log(`[EnvUtils] Could not copy ${file} (may not exist)`);
			}
		}

		// Log directory contents after copy
		try {
			const files = await fs.readdir(settingsDir);
			console.log(`[EnvUtils] Files in temp Gemini dir (${settingsDir}):`, files);
		} catch (_e) {
			console.log(`[EnvUtils] Could not list temp Gemini dir`);
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
	} catch (_e) {
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
		// Reverting to gemini-api-key to ensure GoogleGenAI client is used, which supports GEMINI_API_BASE
		settings.security.auth.selectedType = "gemini-api-key";
		console.log(
			"[EnvUtils] Configured Gemini security.auth.selectedType = gemini-api-key",
		);
	} else {
		// For standard models, ensure we use OAuth authentication
		// Must explicitly set oauth-personal, Gemini CLI won't work without an auth type
		if (!settings.security) settings.security = {};
		if (!settings.security.auth) settings.security.auth = {};
		if (settings.security.auth.selectedType !== "oauth-personal") {
			settings.security.auth.selectedType = "oauth-personal";
			console.log(
				"[EnvUtils] Set auth type to oauth-personal for standard model",
			);
		}
	}

	// Plan or Ask mode: exclude prohibited tools (cognitive control)
	// Plan or Ask mode: exclude prohibited tools (cognitive control)
	if (mode === "plan" || mode === "ask") {
		if (!settings.tools) settings.tools = {};

		const toolsToExclude = [
			"codeExecution",
			"EditFile",
			"edit_file",
			"replace_file_content",
			"write_to_file",
			"WriteToFile",
			"RunCommand",
			"run_command",
		];

		const currentExcludes = settings.tools.exclude || [];
		settings.tools.exclude = Array.from(
			new Set([...currentExcludes, ...toolsToExclude]),
		);

		console.log(
			`[EnvUtils] ${mode} Mode: excluding tools in settings.json: ${toolsToExclude.join(", ")}`,
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
			} catch (_e) {
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
	} catch (_e) {
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