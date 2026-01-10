import type { AgentConfig } from "@agent-manager/shared";

export interface AgentDriverCommand {
	command: string;
	args: string[];
}

export interface AgentDriverContext {
	sessionId: string;
	messageCount: number;
	geminiSessionId?: string;
	codexSessionId?: string;
	codexThreadId?: string;
	mcpServerUrl?: string; // URL for internal MCP server injection
}

export interface AgentDriver {
	getCommand(
		context: AgentDriverContext,
		message: string,
		config: AgentConfig,
		systemPrompt?: string,
	): AgentDriverCommand;
}

/**
 * Combine system prompt and user message into a single message.
 * Used by drivers that don't have native system prompt support.
 */
export function buildFullMessage(
	message: string,
	systemPrompt?: string,
): string {
	if (systemPrompt) {
		return `${systemPrompt}\n\n${message}`;
	}
	return message;
}

export function splitCommand(command: string): AgentDriverCommand {
	const parts: string[] = [];
	let current = "";
	let quote: '"' | "'" | null = null;

	for (let i = 0; i < command.length; i++) {
		const char = command[i];

		if (quote) {
			if (char === quote) {
				quote = null;
				continue;
			}
			if (char === "\\" && i + 1 < command.length) {
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
				current = "";
			}
			continue;
		}

		if (char === "\\" && i + 1 < command.length) {
			current += command[i + 1];
			i++;
			continue;
		}

		current += char;
	}

	if (current) {
		parts.push(current);
	}

	const cmd = parts.shift() || "";
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

/**
 * Strip ANSI escape sequences from a string.
 * Useful for cleaning terminal output for parsing.
 */
export function stripAnsi(str: string): string {
	// biome-ignore lint/suspicious/noControlCharactersInRegex: Intentional ANSI escape sequence pattern
	return str.replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, "");
}
