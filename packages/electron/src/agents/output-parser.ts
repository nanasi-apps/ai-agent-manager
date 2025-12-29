import type { AgentType } from "@agent-manager/shared";

/**
 * Parsed log entry from agent output
 */
export interface ParsedLog {
	data: string;
	type: "text" | "tool_call" | "tool_result" | "thinking" | "error" | "system";
	raw?: unknown;
	metadata?: ParsedLogMetadata;
}

/**
 * Metadata extracted from agent output (e.g., session IDs for resume)
 */
export interface ParsedLogMetadata {
	geminiSessionId?: string;
	codexThreadId?: string;
}

/**
 * Parser for agent CLI JSON output
 * Handles Gemini, Claude, and Codex output formats
 */
export class AgentOutputParser {
	processJsonEvent(json: unknown, agentType: AgentType): ParsedLog[] {
		if (typeof json !== "object" || json === null) {
			return [];
		}

		const obj = json as Record<string, unknown>;
		const results: ParsedLog[] = [];

		if (agentType === "gemini") {
			this.processGeminiJson(obj, results);
		} else if (agentType === "claude") {
			this.processClaudeJson(obj, results);
		} else if (agentType === "codex") {
			this.processCodexJson(obj, results);
		} else {
			// Generic JSON output
			if (obj.content || obj.text || obj.message) {
				results.push({
					data: String(obj.content || obj.text || obj.message),
					type: "text",
					raw: json,
				});
			} else {
				// Fallback for generic JSON
				results.push({
					data: JSON.stringify(json, null, 2) + "\n",
					type: "text",
					raw: json,
				});
			}
		}

		return results;
	}

	private processGeminiJson(
		json: Record<string, unknown>,
		results: ParsedLog[],
	) {
		const type = json.type as string | undefined;

		switch (type) {
			case "init": {
				// Session initialization - extract session ID
				const model = json.model || "unknown";
				const sessionUuid = json.session_id || json.sessionId || json.session;

				const log: ParsedLog = {
					data: `[Using model: ${model}]\n`,
					type: "system",
					raw: json,
				};

				if (sessionUuid) {
					log.metadata = { geminiSessionId: String(sessionUuid) };
				}

				results.push(log);
				break;
			}
			case "message": {
				const role = json.role as string | undefined;
				const content = json.content as string | undefined;
				if (role === "assistant" && content) {
					results.push({
						data: content,
						type: "text",
						raw: json,
					});
				}
				break;
			}
			case "text":
			case "partial": {
				const content = json.content || json.text || "";
				results.push({
					data: String(content),
					type: "text",
					raw: json,
				});
				break;
			}
			case "tool_use":
			case "tool_call": {
				const toolName = json.tool_name || json.name || "unknown";
				const params = json.parameters || json.arguments || json.input || {};
				results.push({
					data: `\n[Tool: ${toolName}]\n${JSON.stringify(params, null, 2)}\n`,
					type: "tool_call",
					raw: json,
				});
				break;
			}
			case "tool_result": {
				const status = json.status as string | undefined;
				const output = json.output as string | undefined;
				const result = json.result as string | undefined;

				let text = "";
				if (output) {
					text = `[Result: ${status}] ${output}\n`;
				} else if (result) {
					text = `[Result]\n${result}\n`;
				} else {
					text = `[Result]\n${JSON.stringify(json, null, 2)}\n`;
				}

				results.push({
					data: text,
					type: "tool_result",
					raw: json,
				});
				break;
			}
			case "thinking": {
				const content = json.content || json.thinking || "";
				results.push({
					data: `[Thinking] ${content}\n`,
					type: "thinking",
					raw: json,
				});
				break;
			}
			case "error": {
				const error = json.message || json.error || "Unknown error";
				results.push({
					data: `[Error] ${error}\n`,
					type: "error",
					raw: json,
				});
				break;
			}
			case "result": {
				// Final result with stats - logged to console only
				break;
			}
			default:
				if (json.content) {
					results.push({ data: String(json.content), type: "text", raw: json });
				} else if (json.text) {
					results.push({ data: String(json.text), type: "text", raw: json });
				}
		}
	}

	private processClaudeJson(
		json: Record<string, unknown>,
		results: ParsedLog[],
	) {
		const type = json.type as string | undefined;

		switch (type) {
			case "assistant": {
				const message = json.message as Record<string, unknown> | undefined;
				if (message?.content) {
					const content = message.content;
					if (Array.isArray(content)) {
						for (const block of content) {
							if (block.type === "text") {
								results.push({
									data: block.text + "\n",
									type: "text",
									raw: json,
								});
							} else if (block.type === "tool_use") {
								results.push({
									data: `\n[Tool: ${block.name}]\n${JSON.stringify(block.input, null, 2)}\n`,
									type: "tool_call",
									raw: json,
								});
							}
						}
					} else {
						results.push({ data: String(content), type: "text", raw: json });
					}
				}
				break;
			}
			case "content_block_delta": {
				const delta = json.delta as Record<string, unknown> | undefined;
				if (delta?.type === "text_delta") {
					results.push({
						data: String(delta.text || ""),
						type: "text",
						raw: json,
					});
				} else if (delta?.type === "input_json_delta") {
					results.push({
						data: String(delta.partial_json || ""),
						type: "tool_call",
						raw: json,
					});
				}
				break;
			}
			case "content_block_start": {
				const contentBlock = json.content_block as
					| Record<string, unknown>
					| undefined;
				if (contentBlock?.type === "tool_use") {
					results.push({
						data: `\n[Tool: ${contentBlock.name}]\n`,
						type: "tool_call",
						raw: json,
					});
				}
				break;
			}
			case "tool_result": {
				const content = json.content || "";
				results.push({
					data: `[Result]\n${content}\n`,
					type: "tool_result",
					raw: json,
				});
				break;
			}
			case "result": {
				const result = json.result as Record<string, unknown> | undefined;
				if (result?.assistant) {
					results.push({
						data: String(result.assistant),
						type: "text",
						raw: json,
					});
				}
				break;
			}
			case "error": {
				const error = json.error as Record<string, unknown> | undefined;
				results.push({
					data: `[Error] ${error?.message || "Unknown error"}\n`,
					type: "error",
					raw: json,
				});
				break;
			}
			case "system": {
				const message = json.message || json.subtype || "";
				results.push({
					data: `[System] ${message}\n`,
					type: "system",
					raw: json,
				});
				break;
			}
			default:
				if (json.content) {
					results.push({ data: String(json.content), type: "text", raw: json });
				} else if (json.text) {
					results.push({ data: String(json.text), type: "text", raw: json });
				} else if (json.message && typeof json.message === "string") {
					results.push({ data: json.message + "\n", type: "text", raw: json });
				}
		}
	}

	private processCodexJson(
		json: Record<string, unknown>,
		results: ParsedLog[],
	) {
		const type = json.type as string | undefined;

		switch (type) {
			case "thread.started": {
				// Thread initialization - extract thread ID for resume
				const threadId = json.thread_id as string | undefined;

				const log: ParsedLog = {
					data: `[Session started]\n`,
					type: "system",
					raw: json,
				};

				if (threadId) {
					log.metadata = { codexThreadId: threadId };
				}

				results.push(log);
				break;
			}
			case "turn.started": {
				// Turn started - silent
				break;
			}
			case "turn.completed": {
				// Turn completed with usage stats - silent
				break;
			}
			case "turn.failed": {
				const error = json.error || "Unknown error";
				results.push({ data: `[Error] ${error}\n`, type: "error", raw: json });
				break;
			}
			case "item.started": {
				const item = json.item as Record<string, unknown> | undefined;
				if (item) {
					const itemType = item.type as string | undefined;
					if (itemType === "command_execution") {
						const command = item.command as string | undefined;
						if (command) {
							results.push({
								data: `\n[Executing: ${command}]\n`,
								type: "tool_call",
								raw: json,
							});
						}
					}
				}
				break;
			}
			case "item.completed": {
				const item = json.item as Record<string, unknown> | undefined;
				if (item) {
					const itemType = item.type as string | undefined;
					switch (itemType) {
						case "agent_message": {
							const text = item.text as string | undefined;
							if (text) {
								results.push({ data: text, type: "text", raw: json });
							}
							break;
						}
						case "reasoning": {
							const text = item.text as string | undefined;
							if (text) {
								results.push({
									data: `[Thinking] ${text}\n`,
									type: "thinking",
									raw: json,
								});
							}
							break;
						}
						case "command_execution": {
							const exitCode = item.exit_code as number | null | undefined;
							const output = item.aggregated_output as string | undefined;

							let text = "";
							if (output) {
								text = `[Output]\n${output}\n`;
							}
							if (exitCode !== null && exitCode !== undefined) {
								text += `[Exit code: ${exitCode}]\n`;
							}
							if (text) {
								results.push({ data: text, type: "tool_result", raw: json });
							}
							break;
						}
						case "file_change": {
							const filePath = item.file_path as string | undefined;
							const changeType = item.change_type as string | undefined;
							if (filePath) {
								results.push({
									data: `[File ${changeType || "changed"}: ${filePath}]\n`,
									type: "tool_result",
									raw: json,
								});
							}
							break;
						}
						default:
							break;
					}
				}
				break;
			}
			case "error": {
				const message = json.message || json.error || "Unknown error";
				results.push({
					data: `[Error] ${message}\n`,
					type: "error",
					raw: json,
				});
				break;
			}
			default:
				if (json.text) {
					results.push({ data: String(json.text), type: "text", raw: json });
				} else if (json.message && typeof json.message === "string") {
					results.push({ data: json.message + "\n", type: "text", raw: json });
				}
		}
	}
}
