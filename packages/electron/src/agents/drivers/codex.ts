import { AgentDriver, AgentDriverCommand, AgentDriverContext } from "./interface";

export class CodexDriver implements AgentDriver {
    getCommand(context: AgentDriverContext, message: string): AgentDriverCommand {
        let args: string[];

        if (context.messageCount === 0) {
            args = ['exec', '--json', '--full-auto', message];
        } else if (context.codexThreadId) {
            args = ['exec', '--json', 'resume', context.codexThreadId, message];
        } else {
            console.warn('[CodexDriver] No codexThreadId stored, using --last fallback');
            args = ['exec', '--json', 'resume', '--last', message];
        }

        return {
            command: 'codex',
            args
        };
    }
}
