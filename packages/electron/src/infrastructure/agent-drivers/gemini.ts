import type { AgentConfig } from "@agent-manager/shared";
import type {
	AgentDriver,
	AgentDriverCommand,
	AgentDriverContext,
} from "./interface";
import { buildFullMessage, shellEscape, splitCommand } from "./interface";

export class GeminiDriver implements AgentDriver {
	getCommand(
		context: AgentDriverContext,
		message: string,
		config: AgentConfig,
		systemPrompt?: string,
	): AgentDriverCommand {
		let args: string[];
		const base = splitCommand(config.command || "gemini");
		const modelArgs = config.model ? ["--model", config.model] : [];

		// Combine system prompt and message, then escape for shell
		const finalMessage = buildFullMessage(message, systemPrompt);
		const escapedMessage = shellEscape(finalMessage);

		// Initialize with base command arguments
		const commonArgs: string[] = [...base.args];

		// Gemini CLI does not support -c flags for config injection in the same way Codex does.
		// We rely on settings.json configuration managed by OneShotAgentManager.

		if (context.messageCount === 0) {
			// First message: start fresh
			args = [...commonArgs, ...modelArgs, escapedMessage];
		} else if (context.geminiSessionId) {
			// We have a valid session ID: resume it
			args = [
				"--resume",
				context.geminiSessionId,
				...commonArgs,
				...modelArgs,
				escapedMessage,
			];
		} else {
			// No session ID but not first message:
			// This can happen if agent was swapped or session ID capture failed.
			// Start fresh rather than using dangerous '--resume latest'
			console.warn(
				"[GeminiDriver] No geminiSessionId stored, starting fresh session",
			);
			args = [...commonArgs, ...modelArgs, escapedMessage];
		}

		return {
			command: base.command || "gemini",
			args,
		};
	}
}
