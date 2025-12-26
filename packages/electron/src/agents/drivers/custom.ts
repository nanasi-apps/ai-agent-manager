import { AgentConfig } from "@agent-manager/shared";
import { AgentDriver, AgentDriverCommand, AgentDriverContext } from "./interface";

export class CustomDriver implements AgentDriver {
    constructor(private config: AgentConfig) { }

    getCommand(context: AgentDriverContext, message: string): AgentDriverCommand {
        const parts = this.config.command.split(' ');
        const command = parts[0];
        const args = [...parts.slice(1), message];

        return {
            command,
            args
        };
    }
}
