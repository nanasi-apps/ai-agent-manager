import { AgentDriver, AgentDriverCommand, AgentDriverContext } from "./interface";

export class GeminiDriver implements AgentDriver {
    getCommand(context: AgentDriverContext, message: string): AgentDriverCommand {
        let args: string[];

        if (context.messageCount === 0) {
            args = ['-y', '--output-format', 'stream-json', message];
        } else if (context.geminiSessionId) {
            args = ['--resume', context.geminiSessionId, '-y', '--output-format', 'stream-json', message];
        } else {
            console.warn('[GeminiDriver] No geminiSessionId stored, using fallback');
            args = ['--resume', 'latest', '-y', '--output-format', 'stream-json', message];
        }

        return {
            command: 'gemini',
            args
        };
    }
}
