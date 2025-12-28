import type { AgentConfig } from "@agent-manager/shared";

export interface AgentDriverCommand {
    command: string;
    args: string[];
}

export interface AgentDriverContext {
    sessionId: string;
    messageCount: number;
    geminiSessionId?: string;
    codexThreadId?: string;
    mcpServerUrl?: string; // URL for internal MCP server injection
}

export interface AgentDriver {
    getCommand(context: AgentDriverContext, message: string, config: AgentConfig, systemPrompt?: string): AgentDriverCommand;
}

export function splitCommand(command: string): AgentDriverCommand {
    const parts: string[] = [];
    let current = '';
    let quote: '"' | "'" | null = null;

    for (let i = 0; i < command.length; i++) {
        const char = command[i];

        if (quote) {
            if (char === quote) {
                quote = null;
                continue;
            }
            if (char === '\\' && i + 1 < command.length) {
                current += command[i + 1];
                i++;
                continue;
            }
            current += char;
            continue;
        }

        if (char === '"' || char === "'") {
            quote = char;
            continue;
        }

        if (/\s/.test(char)) {
            if (current) {
                parts.push(current);
                current = '';
            }
            continue;
        }

        if (char === '\\' && i + 1 < command.length) {
            current += command[i + 1];
            i++;
            continue;
        }

        current += char;
    }

    if (current) {
        parts.push(current);
    }

    const cmd = parts.shift() || '';
    return { command: cmd, args: parts };
}

/**
 * Escape a string for safe use as a shell argument.
 * Wraps the string in single quotes and escapes any internal single quotes.
 * This is required when using spawn with shell: true.
 */
export function shellEscape(arg: string): string {
    // Replace single quotes with '\'' (end quote, escaped quote, start quote)
    const escaped = arg.replace(/'/g, "'\\''");
    return `'${escaped}'`;
}
