import type {
	AgentConfig,
	AgentMode,
	ReasoningLevel,
} from "@agent-manager/shared";
import type {
	AgentDriver,
	AgentDriverCommand,
	AgentDriverContext,
} from "./interface";
import { buildFullMessage, shellEscape, splitCommand } from "./interface";
import { detectAgentType } from "../agent-type-utils";
import { store } from "../../store";

export class CodexDriver implements AgentDriver {
	getCommand(
		context: AgentDriverContext,
		message: string,
		config: AgentConfig,
		systemPrompt?: string,
	): AgentDriverCommand {
		const base = splitCommand(config.command || "codex");

		// Combine system prompt and message, then escape for shell
		const fullMessage = buildFullMessage(message, systemPrompt);
		const escapedMessage = shellEscape(fullMessage);

		// Check if --json mode was requested (only supported for initial exec)
		const hasJson = base.args.includes("--json");
		const jsonArgsExec = hasJson ? ["--json"] : [];

		// Check if --full-auto was requested
		const hasFullAuto = base.args.includes("--full-auto");
		const fullAutoArgs = hasFullAuto ? ["--full-auto"] : [];

		let args: string[];

		// Inject MCP server configuration via -c flags if URL is provided
		const mcpArgs: string[] = [];
		if (context.mcpServerUrl) {
			mcpArgs.push(
				"-c",
				`mcp_servers.agents-manager-mcp.url=${context.mcpServerUrl}`,
			);
			mcpArgs.push("-c", `mcp_servers.agents-manager-mcp.enabled=true`);
		}

		const reasoningArgs = buildReasoningArgs(config.model, config.reasoning);

		// Plan/Ask mode: restrict to read-only sandbox to disable file writes and command execution
		// This is Codex's equivalent of Gemini's tools.exclude feature
		const modeArgs = buildModeArgs(config.mode);

		const customApiArgs = buildCustomApiArgs(config);

		if (context.messageCount === 0) {
			// First message: start fresh
			// Usage: codex exec [OPTIONS] [PROMPT]
			// -m/--model is available for exec
			const modelArgs = config.model ? ["-m", config.model] : [];
			args = [
				"exec",
				...fullAutoArgs,
				...jsonArgsExec,
				...modelArgs,
				...reasoningArgs,
				...modeArgs,
				...mcpArgs,
				...customApiArgs,
				escapedMessage,
			];
		} else if (context.codexSessionId || context.codexThreadId) {
			// Resume existing session or thread
			// Usage: codex exec resume [OPTIONS] [SESSION_ID] [PROMPT]
			// Note: -m/--model is NOT available for resume subcommand, must use -c model="..."
			const resumeId = context.codexSessionId || context.codexThreadId;
			const modelArgs = config.model ? ["-c", `model="${config.model}"`] : [];
			args = [
				"exec",
				...fullAutoArgs,
				...jsonArgsExec,
				"resume",
				...modelArgs,
				...reasoningArgs,
				...modeArgs,
				...mcpArgs,
				...customApiArgs,
				resumeId!,
				escapedMessage,
			];
		} else {
			// No session ID but not first message:
			// Start fresh rather than using unreliable sessionId as resume target
			console.warn(
				"[CodexDriver] No codexSessionId/ThreadId stored, starting fresh session",
			);
			const modelArgs = config.model ? ["-m", config.model] : [];
			args = [
				"exec",
				...fullAutoArgs,
				...jsonArgsExec,
				...modelArgs,
				...reasoningArgs,
				...modeArgs,
				...mcpArgs,
				escapedMessage,
			];
		}

		return {
			command: base.command || "codex",
			args,
		};
	}
}

function buildReasoningArgs(
	model?: string,
	reasoning?: ReasoningLevel,
): string[] {
	if (!isGptModel(model)) return [];

	const resolvedReasoning = reasoning ?? "middle";
	const mapped = mapReasoningLevel(resolvedReasoning);
	return ["-c", `reasoning="${mapped}"`];
}

function isGptModel(model?: string): boolean {
	if (!model) return true;
	return model.toLowerCase().startsWith("gpt");
}

function mapReasoningLevel(level: ReasoningLevel): string {
	if (level === "middle") return "medium";
	if (level === "extraHigh") return "extra_high";
	return level;
}

/**
 * Build mode-specific arguments for Codex CLI
 * Plan/Ask modes use read-only sandbox to restrict file writes and command execution
 */
function buildModeArgs(mode?: AgentMode): string[] {
	if (mode === "plan" || mode === "ask") {
		// Use read-only sandbox to disable file writes and command execution
		// This is the closest equivalent to Gemini's tools.exclude feature
		return ["--sandbox", "read-only"];
	}
	return [];
}

/**
 * Build custom API provider arguments for Codex CLI
 * 
 * @param config
 */
function buildCustomApiArgs(config?: AgentConfig): string[] {
	console.log(config)
	if (!config) return [];
	const apiSettings = store.getApiSettings();

	const modelType = detectAgentType(config)
	if (config.provider && modelType.isCodex) {
		const provider = apiSettings.providers?.find((provider) => provider.id === config.provider);

		if (!provider) return [];
		const providerKey = `model_providers.${provider.id}`;
		const args = [
			'-c', `${providerKey}.name="${provider.name}"`,
			'-c', `model_provider=${provider.id}`,
		];

		if (provider.type === "codex" || provider.type === "openai" || provider.type === "openai_compatible")  {
			// Codex / OpenAI / OpenAI Compatible
			// These are now flattened in ModelProviderCodex
			if (provider.baseUrl) {
				args.push('-c', `${providerKey}.base_url="${provider.baseUrl}"`);
			}
			if (provider.envKey) {
				args.push('-c', `${providerKey}.env_key="${provider.envKey}"`);
			}
		}

		return args;
	}
	return [];
}
