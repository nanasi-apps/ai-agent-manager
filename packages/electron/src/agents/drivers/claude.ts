import type { AgentConfig } from "@agent-manager/shared";
import type {
	AgentDriver,
	AgentDriverCommand,
	AgentDriverContext,
} from "./interface";
import { buildFullMessage, shellEscape, splitCommand } from "./interface";

export class ClaudeDriver implements AgentDriver {
	getCommand(
		context: AgentDriverContext,
		message: string,
		config: AgentConfig,
		systemPrompt?: string,
	): AgentDriverCommand {
		const base = splitCommand(config.command || "claude");
		const modelArgs = config.model ? ["--model", config.model] : [];

		// Combine system prompt and message
		const fullMessage = buildFullMessage(message, systemPrompt);

		// Escape message for shell - handles newlines, special characters, brackets, etc.
		const escapedMessage = shellEscape(fullMessage);

		return {
			command: base.command || "claude",
			args: [...base.args, ...modelArgs, escapedMessage],
		};
	}
}
