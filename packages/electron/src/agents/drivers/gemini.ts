import type { AgentConfig } from "@agent-manager/shared";
import type { AgentDriver, AgentDriverCommand, AgentDriverContext } from "./interface";
import { splitCommand, shellEscape } from "./interface";

export class GeminiDriver implements AgentDriver {
    getCommand(context: AgentDriverContext, message: string, config: AgentConfig): AgentDriverCommand {
        let args: string[];
        const base = splitCommand(config.command || 'gemini');
        const modelArgs = config.model ? ['--model', config.model] : [];

        // Escape message for shell - handles newlines, special characters, brackets, etc.
        const escapedMessage = shellEscape(message);

        if (context.messageCount === 0) {
            // First message: start fresh
            args = [...base.args, ...modelArgs, escapedMessage];
        } else if (context.geminiSessionId) {
            // We have a valid session ID: resume it
            args = ['--resume', context.geminiSessionId, ...base.args, ...modelArgs, escapedMessage];
        } else {
            // No session ID but not first message: 
            // This can happen if agent was swapped or session ID capture failed.
            // Start fresh rather than using dangerous '--resume latest'
            console.warn('[GeminiDriver] No geminiSessionId stored, starting fresh session');
            args = [...base.args, ...modelArgs, escapedMessage];
        }

        return {
            command: base.command || 'gemini',
            args
        };
    }
}


