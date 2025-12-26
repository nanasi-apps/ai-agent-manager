import { AgentDriver, AgentDriverCommand, AgentDriverContext } from "./interface";

export class ClaudeDriver implements AgentDriver {
    getCommand(context: AgentDriverContext, message: string): AgentDriverCommand {
        return {
            command: 'claude',
            args: ['-p', '--output-format', 'stream-json', message]
        };
    }
}
