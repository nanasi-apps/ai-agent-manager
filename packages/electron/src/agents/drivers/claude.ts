import type { AgentConfig } from "@agent-manager/shared";
import type { AgentDriver, AgentDriverCommand, AgentDriverContext } from "./interface";
import { splitCommand, shellEscape } from "./interface";

export class ClaudeDriver implements AgentDriver {
    getCommand(context: AgentDriverContext, message: string, config: AgentConfig): AgentDriverCommand {
        const base = splitCommand(config.command || 'claude');
        const modelArgs = config.model ? ['--model', config.model] : [];

        // Escape message for shell - handles newlines, special characters, brackets, etc.
        const escapedMessage = shellEscape(message);

        return {
            command: base.command || 'claude',
            args: [...base.args, ...modelArgs, escapedMessage]
        };
    }
}

