import type { AgentConfig } from "@agent-manager/shared";
import type { AgentDriver, AgentDriverCommand, AgentDriverContext } from "./interface";
import { splitCommand, shellEscape } from "./interface";

export class CodexDriver implements AgentDriver {
    getCommand(context: AgentDriverContext, message: string, config: AgentConfig, systemPrompt?: string): AgentDriverCommand {
        const base = splitCommand(config.command || 'codex');

        // Prepend system prompt if present
        const fullMessage = systemPrompt ? `${systemPrompt}\n\n${message}` : message;

        // Escape message for shell - handles newlines, special characters, brackets, etc.
        const escapedMessage = shellEscape(fullMessage);

        // Check if --json mode was requested
        const hasJson = base.args.includes('--json');
        const jsonArgs = hasJson ? ['--json'] : [];

        // Check if --full-auto was requested
        const hasFullAuto = base.args.includes('--full-auto');
        const fullAutoArgs = hasFullAuto ? ['--full-auto'] : [];

        let args: string[];

        // Inject MCP server configuration via -c flags if URL is provided
        const mcpArgs: string[] = [];
        if (context.mcpServerUrl) {
            mcpArgs.push('-c', `mcp_servers.agents-manager-mcp.url=${context.mcpServerUrl}`);
            mcpArgs.push('-c', `mcp_servers.agents-manager-mcp.enabled=true`);
        }

        if (context.messageCount === 0) {
            // First message: start fresh
            // Usage: codex exec [OPTIONS] [PROMPT]
            // -m/--model is available for exec
            const modelArgs = config.model ? ['-m', config.model] : [];
            args = ['exec', ...fullAutoArgs, ...jsonArgs, ...modelArgs, ...mcpArgs, escapedMessage];
        } else if (context.codexThreadId) {
            // Resume existing session
            // Usage: codex exec resume [OPTIONS] [SESSION_ID] [PROMPT]
            // Note: -m/--model is NOT available for resume subcommand, must use -c model="..."
            const modelArgs = config.model ? ['-c', `model="${config.model}"`] : [];
            args = ['exec', ...jsonArgs, 'resume', ...modelArgs, ...mcpArgs, context.codexThreadId, escapedMessage];
        } else {
            // No thread ID but not first message:
            // Start fresh rather than using unreliable sessionId as resume target
            console.warn('[CodexDriver] No codexThreadId stored, starting fresh session');
            const modelArgs = config.model ? ['-m', config.model] : [];
            args = ['exec', ...fullAutoArgs, ...jsonArgs, ...modelArgs, ...mcpArgs, escapedMessage];
        }

        return {
            command: base.command || 'codex',
            args
        };
    }
}
