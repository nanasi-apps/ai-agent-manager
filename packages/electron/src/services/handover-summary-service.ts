import { spawn } from "node:child_process";

/**
 * Prompt for generating handover summaries
 */
export const HANDOVER_SUMMARY_PROMPT = `Please provide a concise summary of the conversation so far, focusing on:
1. The main objectives discussed
2. Key decisions made
3. Current progress or status
4. Any pending items or next steps

Format the summary in a clear, structured way that would help a new agent understand the context quickly.`;

/**
 * Options for generating a summary
 */
export interface SummaryOptions {
	agentType: string;
	context: string;
	cwd: string;
	timeoutMs?: number;
	metadata?: {
		geminiSessionId?: string;
		codexSessionId?: string;
		codexThreadId?: string;
	};
}

/**
 * Generate a summary using an agent CLI process.
 * This function spawns a CLI process to generate a summarized context
 * for handover between different agents.
 *
 * @param options - Summary generation options
 * @returns Promise resolving to the summary string or null if generation failed
 */
const DEFAULT_SUMMARY_TIMEOUT_MS = 10000;

export function generateAgentSummary(
	options: SummaryOptions,
): Promise<string | null> {
	const { agentType, context, cwd, metadata, timeoutMs } = options;

	return new Promise((resolve) => {
		const resolvedTimeoutMs = timeoutMs ?? DEFAULT_SUMMARY_TIMEOUT_MS;
		let command = "";
		let args: string[] = [];
		const prompt = HANDOVER_SUMMARY_PROMPT;

		// Determine command based on agent type
		if (agentType === "codex" && metadata?.codexSessionId) {
			command = "codex";
			args = [
				"exec",
				"resume",
				"-m",
				"gpt-5.2",
				metadata.codexSessionId,
				prompt,
			];
		} else if (agentType === "codex" && metadata?.codexThreadId) {
			command = "codex";
			args = [
				"exec",
				"resume",
				"-m",
				"gpt-5.2",
				metadata.codexThreadId,
				prompt,
			];
		} else if (agentType === "gemini" && metadata?.geminiSessionId) {
			command = "gemini";
			args = ["--resume", metadata.geminiSessionId, "-y", prompt];
		} else if (agentType === "claude") {
			command = "claude";
			args = ["-p", prompt];
		} else {
			if (agentType === "codex") {
				command = "codex";
				args = ["exec", "-m", "gpt-5.2", prompt];
			} else if (agentType === "gemini") {
				command = "gemini";
				args = ["-y", prompt];
			} else {
				return resolve(null);
			}
		}

		console.log(
			`[HandoverSummaryService] Generating summary with: ${command} ${args.join(" ")}`,
		);

		try {
			const child = spawn(command, args, {
				cwd,
				env: process.env,
				stdio: ["pipe", "pipe", "pipe"],
				shell: true,
			});

			let output = "";
			let stderrOutput = "";
			let settled = false;
			let timeoutId: NodeJS.Timeout | null = null;

			const finish = (value: string | null): void => {
				if (settled) return;
				settled = true;
				if (timeoutId) {
					clearTimeout(timeoutId);
				}
				resolve(value);
			};

			if (resolvedTimeoutMs > 0) {
				timeoutId = setTimeout(() => {
					console.warn(
						`[HandoverSummaryService] Summary generation timed out after ${resolvedTimeoutMs}ms`,
					);
					child.kill();
					finish(null);
				}, resolvedTimeoutMs);
			}

			child.stderr.on("data", (data) => {
				stderrOutput += data.toString();
			});

			const isResuming = args.includes("resume") || args.includes("--resume");
			if (!isResuming) {
				child.stdin.write(context);
			}
			child.stdin.end();

			child.stdout.on("data", (data) => {
				output += data.toString();
			});

			child.on("close", (code) => {
				if (code === 0 && output.trim()) {
					finish(output.trim());
				} else {
					console.warn(
						`[HandoverSummaryService] Summary generation failed/empty with code ${code}`,
					);
					if (stderrOutput.trim()) {
						console.warn(
							`[HandoverSummaryService] Summary stderr: ${stderrOutput.trim()}`,
						);
					}
					if (output.trim()) {
						console.warn(
							`[HandoverSummaryService] Summary stdout: ${output.trim().slice(0, 200)}`,
						);
					}
					finish(null);
				}
			});

			child.on("error", (err) => {
				console.error(
					`[HandoverSummaryService] Summary generation error: ${err}`,
				);
				finish(null);
			});
		} catch (e) {
			console.error(
				`[HandoverSummaryService] Summary generation exception: ${e}`,
			);
			resolve(null);
		}
	});
}

/**
 * Summarize content by truncating long text.
 * @param content - The content to summarize
 * @param limit - Maximum character length (default: 300)
 * @returns Truncated content with ellipsis if needed
 */
export function summarizeContent(content: string, limit = 300): string {
	const clean = content
		.replace(/[\r\n]+/g, " ")
		.replace(/\s+/g, " ")
		.trim();
	if (clean.length <= limit) return clean;
	return `${clean.slice(0, limit)}... (truncated)`;
}

/**
 * Build a fallback summary from message history.
 * Used when agent-based summary generation fails.
 *
 * @param messages - Array of messages with role and content
 * @returns Formatted summary string
 */
export function buildFallbackSummary(
	messages: Array<{ role: string; content: string }>,
): string {
	return messages
		.map((m) => {
			const role = m.role === "user" ? "User" : "Agent";
			return `- ${role}: ${summarizeContent(m.content)}`;
		})
		.join("\n");
}
