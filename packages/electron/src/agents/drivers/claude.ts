import type { AgentConfig } from "@agent-manager/shared";
import type {
	AgentDriver,
	AgentDriverCommand,
	AgentDriverContext,
} from "./interface";
import { buildFullMessage, shellEscape, splitCommand } from "./interface";

export class ClaudeDriver implements AgentDriver {
	getCommand(
		_context: AgentDriverContext,
		message: string,
		config: AgentConfig,
		systemPrompt?: string,
	): AgentDriverCommand {
		const base = splitCommand(config.command || "claude");
		const modelArgs = config.model ? ["--model", config.model] : [];

		// Combine system prompt and message, then escape for shell
		const fullMessage = buildFullMessage(message, systemPrompt);
		const escapedMessage = shellEscape(fullMessage);

		return {
			command: base.command || "claude",
			args: [...base.args, ...modelArgs, escapedMessage],
		};
	}
}
