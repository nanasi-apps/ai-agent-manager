import type { AgentConfig } from "@agent-manager/shared";
import type {
	AgentDriver,
	AgentDriverCommand,
	AgentDriverContext,
} from "./interface";
import { shellEscape, splitCommand } from "./interface";

export class CustomDriver implements AgentDriver {
	constructor(private config: AgentConfig) { }

	getCommand(
		context: AgentDriverContext,
		message: string,
		config: AgentConfig,
	): AgentDriverCommand {
		const base = splitCommand(config.command || this.config.command);
		const command = base.command;

		// Escape message for shell
		const escapedMessage = shellEscape(message);
		const args = [...base.args, escapedMessage];

		return {
			command,
			args,
		};
	}
}

