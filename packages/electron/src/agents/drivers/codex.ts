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

        // Codex uses `-m` / `--model` for model specification
        const modelArgs = config.model ? ['-m', config.model] : [];

        // Remove --full-auto from base args if present (will be added back for new sessions)
        const cleanBaseArgs = base.args.filter((arg) => arg !== '--full-auto');

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
            // Codex allows injecting config via -c key=value
            // We inject nested keys for the MCP server definition
            mcpArgs.push('-c', `mcp_servers.agents-manager-mcp.url=${context.mcpServerUrl}`);
            mcpArgs.push('-c', `mcp_servers.agents-manager-mcp.enabled=true`);
        }

        if (context.messageCount === 0) {
            // First message: start fresh with `codex exec <prompt> [options]`
            args = ['exec', ...fullAutoArgs, ...jsonArgs, ...mcpArgs, escapedMessage, ...modelArgs];
        } else if (context.codexThreadId) {
            // We have a valid thread ID: resume it with `codex exec resume <session_id> <prompt> [options]`
            // Usage: codex exec resume [OPTIONS] [SESSION_ID] [PROMPT]
            // Note: MCP args should probably be passed to resume as well if they are per-execution overrides
            args = ['exec', ...jsonArgs, 'resume', ...modelArgs, ...mcpArgs, context.codexThreadId, escapedMessage];
        } else {
            // No thread ID but not first message:
            // This can happen if agent was swapped or thread ID capture failed.
            // Start fresh rather than using unreliable sessionId as resume target
            console.warn('[CodexDriver] No codexThreadId stored, starting fresh session');
            args = ['exec', ...fullAutoArgs, ...jsonArgs, ...mcpArgs, escapedMessage, ...modelArgs];
        }

        return {
            command: base.command || 'codex',
            args
        };
    }
}

