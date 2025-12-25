import type { AgentType } from '@agent-manager/shared';

export interface AgentLogPayload {
    sessionId: string;
    data: string;
    type?: 'text' | 'tool_call' | 'tool_result' | 'thinking' | 'error' | 'system';
    raw?: unknown;
}

export interface ParsedLog {
    data: string;
    type: 'text' | 'tool_call' | 'tool_result' | 'thinking' | 'error' | 'system';
    raw?: unknown;
    metadata?: parentMetadata;
}

interface parentMetadata {
    geminiSessionId?: string;
}

export class AgentOutputParser {

    processJsonEvent(json: unknown, agentType: AgentType): ParsedLog[] {
        if (typeof json !== 'object' || json === null) {
            return [];
        }

        const obj = json as Record<string, unknown>;
        const results: ParsedLog[] = [];

        if (agentType === 'gemini') {
            this.processGeminiJson(obj, results);
        } else if (agentType === 'claude') {
            this.processClaudeJson(obj, results);
        } else {
            // Generic JSON output
            if (obj.content || obj.text || obj.message) {
                results.push({
                    data: String(obj.content || obj.text || obj.message),
                    type: 'text',
                    raw: json
                });
            } else {
                // Fallback for generic JSON
                results.push({
                    data: JSON.stringify(json, null, 2) + '\n',
                    type: 'text',
                    raw: json
                });
            }
        }

        return results;
    }

    private processGeminiJson(json: Record<string, unknown>, results: ParsedLog[]) {
        const type = json.type as string | undefined;

        switch (type) {
            case 'init': {
                // Session initialization - extract session ID
                const model = json.model || 'unknown';
                const sessionUuid = json.session_id || json.sessionId || json.session;

                const log: ParsedLog = {
                    data: `[Using model: ${model}]\n`,
                    type: 'system',
                    raw: json
                };

                if (sessionUuid) {
                    log.metadata = { geminiSessionId: String(sessionUuid) };
                }

                results.push(log);
                break;
            }
            case 'message': {
                const role = json.role as string | undefined;
                const content = json.content as string | undefined;
                if (role === 'assistant' && content) {
                    results.push({
                        data: content,
                        type: 'text',
                        raw: json
                    });
                }
                break;
            }
            case 'text':
            case 'partial': {
                const content = json.content || json.text || '';
                results.push({
                    data: String(content),
                    type: 'text',
                    raw: json
                });
                break;
            }
            case 'tool_use':
            case 'tool_call': {
                const toolName = json.tool_name || json.name || 'unknown';
                const params = json.parameters || json.arguments || json.input || {};
                results.push({
                    data: `\n[Tool: ${toolName}]\n${JSON.stringify(params, null, 2)}\n`,
                    type: 'tool_call',
                    raw: json
                });
                break;
            }
            case 'tool_result': {
                const status = json.status as string | undefined; // oneshot
                const output = json.output as string | undefined; // oneshot
                const result = json.result as string | undefined; // pty

                let text = '';
                if (output) {
                    text = `[Result: ${status}] ${output}\n`;
                } else if (result) {
                    text = `[Result]\n${result}\n`;
                } else {
                    // Fallback
                    text = `[Result]\n${JSON.stringify(json, null, 2)}\n`;
                }

                results.push({
                    data: text,
                    type: 'tool_result',
                    raw: json
                });
                break;
            }
            case 'thinking': {
                const content = json.content || json.thinking || '';
                results.push({
                    data: `[Thinking] ${content}\n`,
                    type: 'thinking',
                    raw: json
                });
                break;
            }
            case 'error': {
                const error = json.message || json.error || 'Unknown error';
                results.push({
                    data: `[Error] ${error}\n`,
                    type: 'error',
                    raw: json
                });
                break;
            }
            case 'result': {
                // Final result with stats
                // PTY doesn't have this, OneShot logs it to console.
                // We can return a system log or text log if needed, or better yet, return it so the caller can decide?
                // OneShot code: console.log(`[Gemini] Stats: ${JSON.stringify(stats)}`);
                // Let's treat it as system log maybe? Or just skip logic in parser?
                // The user said "output parsing logic".
                // Let's add it effectively.
                const stats = json.stats;
                if (stats) {
                    // Maybe not emit to user stream?
                    // OneShot code only logged to console.
                }
                break;
            }
            default:
                if (json.content) {
                    results.push({ data: String(json.content), type: 'text', raw: json });
                } else if (json.text) {
                    results.push({ data: String(json.text), type: 'text', raw: json });
                } else {
                    // For Gemini, we might want to be careful not to spam generic JSON if it's an unhandled type.
                    // usage metadata, prompts etc.
                }
        }
    }

    private processClaudeJson(json: Record<string, unknown>, results: ParsedLog[]) {
        const type = json.type as string | undefined;

        switch (type) {
            case 'assistant': {
                const message = json.message as Record<string, unknown> | undefined;
                if (message?.content) {
                    const content = message.content;
                    if (Array.isArray(content)) {
                        for (const block of content) {
                            if (block.type === 'text') {
                                results.push({ data: block.text + '\n', type: 'text', raw: json });
                            } else if (block.type === 'tool_use') {
                                results.push({
                                    data: `\n[Tool: ${block.name}]\n${JSON.stringify(block.input, null, 2)}\n`,
                                    type: 'tool_call',
                                    raw: json
                                });
                            }
                        }
                    } else {
                        results.push({ data: String(content), type: 'text', raw: json });
                    }
                }
                break;
            }
            case 'content_block_delta': {
                const delta = json.delta as Record<string, unknown> | undefined;
                if (delta?.type === 'text_delta') {
                    results.push({ data: String(delta.text || ''), type: 'text', raw: json });
                } else if (delta?.type === 'input_json_delta') {
                    // PTY handled this
                    results.push({ data: String(delta.partial_json || ''), type: 'tool_call', raw: json });
                }
                break;
            }
            case 'content_block_start': {
                const contentBlock = json.content_block as Record<string, unknown> | undefined;
                if (contentBlock?.type === 'tool_use') {
                    results.push({ data: `\n[Tool: ${contentBlock.name}]\n`, type: 'tool_call', raw: json });
                }
                break;
            }
            case 'tool_result': {
                const content = json.content || '';
                results.push({ data: `[Result]\n${content}\n`, type: 'tool_result', raw: json });
                break;
            }
            case 'result': {
                const result = json.result as Record<string, unknown> | undefined;
                if (result?.assistant) {
                    results.push({ data: String(result.assistant), type: 'text', raw: json });
                }
                break;
            }
            case 'error': {
                const error = json.error as Record<string, unknown> | undefined;
                results.push({ data: `[Error] ${error?.message || 'Unknown error'}\n`, type: 'error', raw: json });
                break;
            }
            case 'system': {
                const message = json.message || json.subtype || '';
                results.push({ data: `[System] ${message}\n`, type: 'system', raw: json });
                break;
            }
            default:
                if (json.content) {
                    results.push({ data: String(json.content), type: 'text', raw: json });
                } else if (json.text) {
                    results.push({ data: String(json.text), type: 'text', raw: json });
                } else if (json.message && typeof json.message === 'string') {
                    results.push({ data: json.message + '\n', type: 'text', raw: json });
                }
        }
    }
}
