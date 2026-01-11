import {
	type AgentType,
	type ErrorEvent,
	generateUUID,
	type LogEvent,
	type SessionEvent,
	type ThinkingEvent,
	type ToolCallEvent,
	type ToolResultEvent,
} from "@agent-manager/shared";
import { SESSION_INVALID_PATTERNS } from "../../infrastructure/agent-drivers/process-utils";

/**
 * Result of parsing a JSON event
 * Contains one or more session events and optional metadata
 */
export interface ParseResult {
	events: SessionEvent[];
	metadata: ParsedLogMetadata;
}

/**
 * Metadata extracted from agent output (e.g., session IDs for resume)
 */
export interface ParsedLogMetadata {
	geminiSessionId?: string;
	codexSessionId?: string;
	codexThreadId?: string;
	/** Indicates the session is invalid and should be restarted fresh */
	sessionInvalid?: boolean;
}

/**
 * Parser for agent CLI JSON output
 * Handles Gemini, Claude, and Codex output formats
 * Converts raw JSON into typed SessionEvents
 */
export class AgentOutputParser {
	private static readonly planToolNames = new Set([
		"planning_create",
		"propose_implementation_plan",
	]);

	constructor(private readonly sessionId: string) {}

	private createBaseEvent(): {
		id: string;
		timestamp: string;
		sessionId: string;
	} {
		return {
			id: generateUUID(),
			timestamp: new Date().toISOString(),
			sessionId: this.sessionId,
		};
	}

	private createLogEvent(
		data: string,
		type: "text" | "system" | "plan" = "text",
		raw?: unknown,
	): LogEvent {
		return {
			...this.createBaseEvent(),
			type: "log",
			payload: {
				sessionId: this.sessionId,
				data,
				type,
				raw,
			},
		};
	}

	private createToolCallEvent(
		toolName: string,
		args: Record<string, unknown>,
	): ToolCallEvent {
		return {
			...this.createBaseEvent(),
			type: "tool-call",
			payload: {
				toolName,
				arguments: args,
			},
		};
	}

	private createToolResultEvent(
		toolName: string,
		result: unknown,
		success = true,
		error?: string,
	): ToolResultEvent {
		return {
			...this.createBaseEvent(),
			type: "tool-result",
			payload: {
				toolName,
				result,
				success,
				error,
			},
		};
	}

	private createThinkingEvent(content: string): ThinkingEvent {
		return {
			...this.createBaseEvent(),
			type: "thinking",
			payload: {
				content,
			},
		};
	}

	private createErrorEvent(message: string, details?: unknown): ErrorEvent {
		return {
			...this.createBaseEvent(),
			type: "error",
			payload: {
				message,
				details,
			},
		};
	}

	private getPlanContent(toolName: unknown, rawParams: unknown): string | null {
		if (typeof toolName !== "string") return null;
		if (!AgentOutputParser.planToolNames.has(toolName)) return null;

		let params: unknown = rawParams;
		if (typeof rawParams === "string") {
			try {
				params = JSON.parse(rawParams) as unknown;
			} catch {
				return null;
			}
		}
		if (!params || typeof params !== "object") return null;

		const planContent = (params as Record<string, unknown>).planContent;
		if (typeof planContent !== "string") return null;
		return planContent.trim() ? planContent : null;
	}

	private extractErrorMessage(value: unknown): string | null {
		if (!value) return null;
		if (typeof value === "string") {
			const trimmed = value.trim();
			return trimmed ? trimmed : null;
		}
		if (typeof value === "object" && value !== null) {
			const message = (value as Record<string, unknown>).message;
			if (typeof message === "string") {
				const trimmed = message.trim();
				return trimmed ? trimmed : null;
			}
		}
		return null;
	}

	processJsonEvent(json: unknown, agentType: AgentType): ParseResult {
		const result: ParseResult = {
			events: [],
			metadata: {},
		};

		if (typeof json !== "object" || json === null) {
			return result;
		}

		const obj = json as Record<string, unknown>;

		if (agentType === "gemini") {
			this.processGeminiJson(obj, result);
		} else if (agentType === "claude") {
			this.processClaudeJson(obj, result);
		} else if (agentType === "codex") {
			this.processCodexJson(obj, result);
		} else {
			// Generic JSON output
			if (obj.content || obj.text || obj.message) {
				result.events.push(
					this.createLogEvent(
						String(obj.content || obj.text || obj.message),
						"text",
						json,
					),
				);
			} else {
				// Fallback for generic JSON
				result.events.push(
					this.createLogEvent(
						`${JSON.stringify(json, null, 2)}\n`,
						"text",
						json,
					),
				);
			}
		}

		return result;
	}

	private processGeminiJson(
		json: Record<string, unknown>,
		result: ParseResult,
	) {
		const type = json.type as string | undefined;

		switch (type) {
			case "init": {
				// Session initialization - extract session ID
				const model = json.model || "unknown";
				const sessionUuid = json.session_id || json.sessionId || json.session;

				result.events.push(
					this.createLogEvent(`[Using model: ${model}]\n`, "system", json),
				);

				if (sessionUuid) {
					result.metadata.geminiSessionId = String(sessionUuid);
				}
				break;
			}
			case "message": {
				const role = json.role as string | undefined;
				const content = json.content as string | undefined;
				if (role === "assistant" && content) {
					result.events.push(this.createLogEvent(content, "text", json));
				}
				break;
			}
			case "text":
			case "partial": {
				const content = json.content || json.text || "";
				result.events.push(this.createLogEvent(String(content), "text", json));
				break;
			}
			case "tool_use":
			case "tool_call": {
				const toolName = String(json.tool_name || json.name || "unknown");
				const params = (json.parameters ||
					json.arguments ||
					json.input ||
					{}) as Record<string, unknown>;

				result.events.push(this.createToolCallEvent(toolName, params));

				// Check for plan content in tool call
				const planContent = this.getPlanContent(toolName, params);
				if (planContent) {
					result.events.push(this.createLogEvent(planContent, "plan", json));
				}
				break;
			}
			case "tool_result": {
				const status = json.status as string | undefined;
				const output = json.output as string | undefined;
				const resVal = json.result as string | undefined;

				// We want to emit a ToolResultEvent if possible
				// But Geminl CLI output format for tool result might just be info
				// The Typed Event expects 'result: unknown'.
				const resultData = output || resVal || json;
				const toolName = "unknown"; // Gemini output might not link back to tool name easily here without context

				// For backward compat visualization, we might also want a LogEvent if the UI doesn't render ToolResultEvent well yet?
				// But we are "unifying around typed events".
				// The parser's job is to be accurate.
				// However, `toolName` is missing in this JSON chunk usually.
				// For now, let's treat it as ToolResultEvent with unknown name, or LogEvent?
				// The original code produced: `[Result: ${status}] ${output}\n`

				// Let's emit LogEvent for now to match visual expectation, OR ToolResultEvent.
				// ToolResultEvent is better for structure.
				// But without toolName it's hard.
				// I'll emit ToolResultEvent with "unknown".
				result.events.push(
					this.createToolResultEvent(
						"unknown",
						resultData,
						status !== "error",
						undefined,
					),
				);
				break;
			}
			case "thinking": {
				const content = String(json.content || json.thinking || "");
				result.events.push(this.createThinkingEvent(content));
				break;
			}
			case "error": {
				const error = String(json.message || json.error || "Unknown error");
				result.events.push(this.createErrorEvent(error, json));
				break;
			}
			case "result": {
				const status = json.status as string | undefined;
				const normalizedStatus = status?.toLowerCase();
				const errorMessage =
					this.extractErrorMessage(json.error) ??
					this.extractErrorMessage(json.message);
				if (normalizedStatus === "error" || errorMessage) {
					result.events.push(
						this.createErrorEvent(errorMessage ?? "Unknown error", json),
					);
				}
				break;
			}
			default:
				if (json.content) {
					result.events.push(
						this.createLogEvent(String(json.content), "text", json),
					);
				} else if (json.text) {
					result.events.push(
						this.createLogEvent(String(json.text), "text", json),
					);
				}
		}
	}

	private processClaudeJson(
		json: Record<string, unknown>,
		result: ParseResult,
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
								result.events.push(
									this.createLogEvent(`${block.text}\n`, "text", json),
								);
							} else if (block.type === "tool_use") {
								// Tool Use
								result.events.push(
									this.createToolCallEvent(
										block.name,
										block.input as Record<string, unknown>,
									),
								);

								const planContent = this.getPlanContent(
									block.name,
									block.input,
								);
								if (planContent) {
									result.events.push(
										this.createLogEvent(planContent, "plan", json),
									);
								}
							}
						}
					} else {
						result.events.push(
							this.createLogEvent(String(content), "text", json),
						);
					}
				}
				break;
			}
			case "content_block_delta": {
				const delta = json.delta as Record<string, unknown> | undefined;
				if (delta?.type === "text_delta") {
					result.events.push(
						this.createLogEvent(String(delta.text || ""), "text", json),
					);
				} else if (delta?.type === "input_json_delta") {
					// Streaming tool args... this is tricky.
					// The UI isn't built to handle partial JSON deltas for tool calls usually?
					// Original code:
					// results.push({ data: String(delta.partial_json || ""), type: "tool_call", raw: json });
					// It just dumped partial JSON string.
					// I'll stick to LogEvent with custom type or just LogEvent text?
					// But original type was "tool_call".
					// Changing it to LogEvent might break "status" detection?
					// I'll emit it as ToolCallEvent? No, that expects full args.
					// I'll emit as LogEvent with type="text" for now, or "tool_call" payload type?
					// AgentLogPayload has "tool_call".
					result.events.push(
						this.createLogEvent(String(delta.partial_json || ""), "text", json),
					);
				}
				break;
			}
			case "content_block_start": {
				const contentBlock = json.content_block as
					| Record<string, unknown>
					| undefined;
				if (contentBlock?.type === "tool_use") {
					// Start of tool use
					// Original: data: `\n[Tool: ${contentBlock.name}]\n`
					// We can emit a ToolCallEvent here with empty args? Or wait?
					// Original emitted "tool_call".
					// I'll emit ToolCallEvent with empty args to signal start.
					result.events.push(
						this.createToolCallEvent(String(contentBlock.name), {}),
					);
				}
				break;
			}
			case "tool_result": {
				const content = json.content || "";
				// Unknown tool name
				result.events.push(
					this.createToolResultEvent("unknown", content, true, undefined),
				);
				break;
			}
			case "result": {
				const res = json.result as Record<string, unknown> | undefined;
				if (res?.assistant) {
					result.events.push(
						this.createLogEvent(String(res.assistant), "text", json),
					);
				}
				break;
			}
			case "error": {
				const error = json.error as Record<string, unknown> | undefined;
				result.events.push(
					this.createErrorEvent(
						String(error?.message || "Unknown error"),
						json,
					),
				);
				break;
			}
			case "system": {
				const message = String(json.message || json.subtype || "");
				result.events.push(this.createLogEvent(message, "system", json));
				break;
			}
			default:
				if (json.content) {
					result.events.push(
						this.createLogEvent(String(json.content), "text", json),
					);
				} else if (json.text) {
					result.events.push(
						this.createLogEvent(String(json.text), "text", json),
					);
				} else if (json.message && typeof json.message === "string") {
					result.events.push(
						this.createLogEvent(`${json.message}\n`, "text", json),
					);
				}
		}
	}

	private processCodexJson(json: Record<string, unknown>, result: ParseResult) {
		const type = json.type as string | undefined;
		const startIndex = result.events.length;
		const sessionId =
			(json.session_id as string | undefined) ||
			(json.sessionId as string | undefined) ||
			(json.session as string | undefined);

		switch (type) {
			case "thread.started": {
				const threadId = json.thread_id as string | undefined;
				result.events.push(
					this.createLogEvent(`[Session started]\n`, "system", json),
				);

				if (threadId || sessionId) {
					if (sessionId) result.metadata.codexSessionId = sessionId;
					if (threadId) result.metadata.codexThreadId = threadId;
				}
				break;
			}
			case "turn.started":
			case "turn.completed":
				break;
			case "turn.failed": {
				const error = json.error || "Unknown error";
				const errorStr = String(error);
				const isInvalid = SESSION_INVALID_PATTERNS.some((p) =>
					errorStr.includes(p),
				);
				result.events.push(this.createErrorEvent(errorStr, json));
				if (isInvalid) {
					result.metadata.sessionInvalid = true;
				}
				break;
			}
			case "item.started": {
				const item = json.item as Record<string, unknown> | undefined;
				if (item) {
					const itemType = item.type as string | undefined;
					if (itemType === "command_execution") {
						const command = String(item.command || "");
						// Original: `\n[Executing: ${command}]\n`
						// I'll emit a ToolCallEvent for "execute_command"?
						// Or just LogEvent?
						// "tool_call" was the type.
						result.events.push(
							this.createToolCallEvent("execute_command", { command }),
						);
					} else if (
						itemType === "tool_call" ||
						itemType === "tool_use" ||
						itemType === "function_call"
					) {
						const toolName = String(
							item.name || item.tool_name || item.toolName || "unknown",
						);
						const rawArgs =
							item.arguments ?? item.input ?? item.parameters ?? item.args;

						let parsedArgs: Record<string, unknown> = {};
						if (rawArgs !== undefined) {
							if (typeof rawArgs === "string") {
								try {
									parsedArgs = JSON.parse(rawArgs);
								} catch {
									parsedArgs = { raw: rawArgs };
								}
							} else {
								parsedArgs = rawArgs as Record<string, unknown>;
							}
						}

						result.events.push(this.createToolCallEvent(toolName, parsedArgs));

						const planContent = this.getPlanContent(toolName, parsedArgs);
						if (planContent) {
							result.events.push(
								this.createLogEvent(planContent, "plan", json),
							);
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
								result.events.push(this.createLogEvent(text, "text", json));
							}
							break;
						}
						case "reasoning": {
							const text = item.text as string | undefined;
							if (text) {
								result.events.push(this.createThinkingEvent(text));
							}
							break;
						}
						case "command_execution": {
							const exitCode = item.exit_code as number | null | undefined;
							const output = item.aggregated_output as string | undefined;
							// Emit as ToolResult
							result.events.push(
								this.createToolResultEvent(
									"execute_command",
									{ output, exitCode },
									exitCode === 0,
									undefined,
								),
							);
							break;
						}
						case "tool_call":
						case "tool_use":
						case "function_call":
						case "tool_result": {
							const output =
								item.output ?? item.result ?? item.content ?? item.response;
							// Emit as ToolResult
							result.events.push(
								this.createToolResultEvent("unknown", output, true, undefined),
							);
							break;
						}
						case "file_change": {
							const filePath = item.file_path as string | undefined;
							const changeType = item.change_type as string | undefined;
							// Emit as ToolResult or Log?
							// Original used "tool_result"
							if (filePath) {
								result.events.push(
									this.createToolResultEvent(
										"file_change",
										{ filePath, changeType },
										true,
										undefined,
									),
								);
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
				const message = String(json.message || json.error || "Unknown error");
				const isInvalid = SESSION_INVALID_PATTERNS.some((p) =>
					message.includes(p),
				);
				result.events.push(this.createErrorEvent(message, json));
				if (isInvalid) {
					result.metadata.sessionInvalid = true;
				}
				break;
			}
			default:
				if (json.type === "message" || json.text) {
					result.events.push(
						this.createLogEvent(
							String(json.text || json.message),
							"text",
							json,
						),
					);
				}
		}

		if (sessionId && result.events.length > startIndex) {
			if (!result.metadata.codexSessionId) {
				result.metadata.codexSessionId = sessionId;
			}
		}
	}
}
