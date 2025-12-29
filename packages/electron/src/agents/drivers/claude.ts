import type { AgentConfig } from "@agent-manager/shared";
import type {
	AgentDriver,
	AgentDriverCommand,
	AgentDriverContext,
} from "./interface";
import { shellEscape, splitCommand } from "./interface";

export class ClaudeDriver implements AgentDriver {
	getCommand(
		context: AgentDriverContext,
		message: string,
		config: AgentConfig,
		systemPrompt?: string,
	): AgentDriverCommand {
		const base = splitCommand(config.command || "claude");
		const modelArgs = config.model ? ["--model", config.model] : [];

		// Prepend system prompt to message if present (fallback for Claude CLI)
		const fullMessage = systemPrompt
			? `${systemPrompt}\n\n${message}`
			: message;

		// Escape message for shell - handles newlines, special characters, brackets, etc.
		const escapedMessage = shellEscape(fullMessage);

		return {
			command: base.command || "claude",
			args: [...base.args, ...modelArgs, escapedMessage],
		};
	}
}
