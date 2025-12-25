import { spawn, type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import type { AgentConfig, AgentType } from './projects';

export interface AgentLogPayload {
    sessionId: string;
    data: string;
    // Parsed from stream-json if available
    type?: 'text' | 'tool_call' | 'tool_result' | 'thinking' | 'error' | 'system';
    // Raw JSON object for stream-json format
    raw?: unknown;
}

interface SessionInfo {
    process: ChildProcess;
    config: AgentConfig;
    buffer: string; // Buffer for incomplete JSON lines
}

export class AgentManager extends EventEmitter {
    // Map sessionId to SessionInfo
    private sessions: Map<string, SessionInfo> = new Map();

    startSession(sessionId: string, command: string, config?: Partial<AgentConfig>) {
        if (this.sessions.has(sessionId)) {
            console.warn(`[AgentManager] Session ${sessionId} is already running.`);
            return;
        }

        console.log(`[AgentManager] Starting session ${sessionId}: ${command}`);

        const agentConfig: AgentConfig = {
            type: config?.type ?? 'custom',
            command,
            cwd: config?.cwd,
            env: config?.env,
            streamJson: config?.streamJson ?? false,
        };

        const [cmd, ...args] = command.split(' ');

        // Merge environment variables
        const processEnv = {
            ...process.env,
            ...agentConfig.env,
            // Force color output for ANSI support
            FORCE_COLOR: '1',
            TERM: 'xterm-256color',
        };

        const childProcess = spawn(cmd, args, {
            shell: true,
            cwd: agentConfig.cwd || process.cwd(),
            stdio: ['pipe', 'pipe', 'pipe'],
            env: processEnv,
        });

        const sessionInfo: SessionInfo = {
            process: childProcess,
            config: agentConfig,
            buffer: '',
        };

        this.sessions.set(sessionId, sessionInfo);

        // Handle stdout
        childProcess.stdout?.on('data', (data: Buffer) => {
            this.handleOutput(sessionId, data.toString(), 'stdout');
        });

        // Handle stderr
        childProcess.stderr?.on('data', (data: Buffer) => {
            this.handleOutput(sessionId, data.toString(), 'stderr');
        });

        childProcess.on('exit', (code) => {
            this.emitLog(sessionId, `\r\n[Process exited with code ${code}]\r\n`, 'system');
            this.sessions.delete(sessionId);
        });

        childProcess.on('error', (err) => {
            this.emitLog(sessionId, `\r\n[Error: ${err.message}]\r\n`, 'error');
        });
    }

    private handleOutput(sessionId: string, data: string, source: 'stdout' | 'stderr') {
        const session = this.sessions.get(sessionId);
        if (!session) return;

        // If using stream-json format, try to parse JSON lines
        if (session.config.streamJson) {
            this.parseStreamJson(sessionId, data, session);
        } else {
            // Raw output mode - emit as-is
            this.emitLog(sessionId, data, 'text');
        }
    }

    private parseStreamJson(sessionId: string, data: string, session: SessionInfo) {
        // Append to buffer
        session.buffer += data;

        // Process complete lines
        const lines = session.buffer.split('\n');
        // Keep the last incomplete line in the buffer
        session.buffer = lines.pop() || '';

        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;

            try {
                const json = JSON.parse(trimmed);
                this.processJsonEvent(sessionId, json, session.config.type);
            } catch {
                // Not valid JSON, emit as raw text
                this.emitLog(sessionId, line + '\n', 'text');
            }
        }
    }

    private processJsonEvent(sessionId: string, json: unknown, agentType: AgentType) {
        // Ensure json is a valid object
        if (typeof json !== 'object' || json === null) {
            this.emitLog(sessionId, String(json) + '\n', 'text', json);
            return;
        }

        const jsonRecord = json as Record<string, unknown>;

        // Handle different CLI's JSON formats
        if (agentType === 'gemini') {
            this.processGeminiJson(sessionId, jsonRecord);
        } else if (agentType === 'claude') {
            this.processClaudeJson(sessionId, jsonRecord);
        } else {
            // Generic JSON output - stringify and display
            this.emitLog(sessionId, JSON.stringify(json, null, 2) + '\n', 'text', json);
        }
    }

    private processGeminiJson(sessionId: string, json: Record<string, unknown>) {
        // Gemini CLI stream-json format
        // Reference: https://github.com/google-gemini/gemini-cli
        const type = json.type as string | undefined;

        switch (type) {
            case 'text':
            case 'partial': {
                const content = json.content || json.text || '';
                this.emitLog(sessionId, String(content), 'text', json);
                break;
            }
            case 'tool_call': {
                const toolName = json.name || 'unknown';
                const args = JSON.stringify(json.arguments || json.input || {}, null, 2);
                this.emitLog(sessionId, `\n[Tool: ${toolName}]\n${args}\n`, 'tool_call', json);
                break;
            }
            case 'tool_result': {
                const result = json.result || json.output || '';
                this.emitLog(sessionId, `[Result]\n${result}\n`, 'tool_result', json);
                break;
            }
            case 'thinking': {
                const thinking = json.content || json.thinking || '';
                this.emitLog(sessionId, `[Thinking] ${thinking}\n`, 'thinking', json);
                break;
            }
            case 'error': {
                const error = json.message || json.error || 'Unknown error';
                this.emitLog(sessionId, `[Error] ${error}\n`, 'error', json);
                break;
            }
            default:
                // Fallback: if there's content, display it
                if (json.content) {
                    this.emitLog(sessionId, String(json.content), 'text', json);
                } else if (json.text) {
                    this.emitLog(sessionId, String(json.text), 'text', json);
                } else {
                    // Unknown format - show raw JSON
                    this.emitLog(sessionId, JSON.stringify(json, null, 2) + '\n', 'text', json);
                }
        }
    }

    private processClaudeJson(sessionId: string, json: Record<string, unknown>) {
        // Claude Code stream-json format
        // Reference: https://docs.anthropic.com/en/docs/build-with-claude/tool-use
        const type = json.type as string | undefined;

        switch (type) {
            case 'assistant': {
                // Main assistant response
                const message = json.message as Record<string, unknown> | undefined;
                if (message?.content) {
                    const content = message.content;
                    if (Array.isArray(content)) {
                        for (const block of content) {
                            if (block.type === 'text') {
                                this.emitLog(sessionId, block.text + '\n', 'text', json);
                            } else if (block.type === 'tool_use') {
                                this.emitLog(sessionId, `\n[Tool: ${block.name}]\n${JSON.stringify(block.input, null, 2)}\n`, 'tool_call', json);
                            }
                        }
                    } else {
                        this.emitLog(sessionId, String(content), 'text', json);
                    }
                }
                break;
            }
            case 'content_block_delta': {
                // Streaming content delta
                const delta = json.delta as Record<string, unknown> | undefined;
                if (delta?.type === 'text_delta') {
                    this.emitLog(sessionId, String(delta.text || ''), 'text', json);
                } else if (delta?.type === 'input_json_delta') {
                    // Tool input streaming
                    this.emitLog(sessionId, String(delta.partial_json || ''), 'tool_call', json);
                }
                break;
            }
            case 'content_block_start': {
                const contentBlock = json.content_block as Record<string, unknown> | undefined;
                if (contentBlock?.type === 'tool_use') {
                    this.emitLog(sessionId, `\n[Tool: ${contentBlock.name}]\n`, 'tool_call', json);
                }
                break;
            }
            case 'tool_result': {
                const content = json.content || '';
                this.emitLog(sessionId, `[Result]\n${content}\n`, 'tool_result', json);
                break;
            }
            case 'result': {
                // Final result
                const result = json.result as Record<string, unknown> | undefined;
                if (result?.assistant) {
                    this.emitLog(sessionId, String(result.assistant), 'text', json);
                }
                break;
            }
            case 'error': {
                const error = json.error as Record<string, unknown> | undefined;
                this.emitLog(sessionId, `[Error] ${error?.message || 'Unknown error'}\n`, 'error', json);
                break;
            }
            case 'system': {
                const message = json.message || json.subtype || '';
                this.emitLog(sessionId, `[System] ${message}\n`, 'system', json);
                break;
            }
            default:
                // Check for common fields
                if (json.content) {
                    this.emitLog(sessionId, String(json.content), 'text', json);
                } else if (json.text) {
                    this.emitLog(sessionId, String(json.text), 'text', json);
                } else if (json.message && typeof json.message === 'string') {
                    this.emitLog(sessionId, json.message + '\n', 'text', json);
                } else {
                    // Unknown format - show raw JSON for debugging
                    this.emitLog(sessionId, JSON.stringify(json, null, 2) + '\n', 'text', json);
                }
        }
    }

    private emitLog(
        sessionId: string,
        data: string,
        type: AgentLogPayload['type'] = 'text',
        raw?: unknown
    ) {
        const payload: AgentLogPayload = {
            sessionId,
            data,
            type,
            raw,
        };
        this.emit('log', payload);
    }

    stopSession(sessionId: string): boolean {
        const session = this.sessions.get(sessionId);
        if (session) {
            session.process.kill();
            this.sessions.delete(sessionId);
            this.emitLog(sessionId, `\r\n[Process killed by user]\r\n`, 'system');
            return true;
        }
        return false;
    }

    sendToSession(sessionId: string, message: string) {
        const session = this.sessions.get(sessionId);
        if (session?.process?.stdin) {
            const agentType = session.config.type;

            // For stream-json input format (Claude), wrap in JSON
            if (agentType === 'claude' && session.config.streamJson) {
                const jsonMessage = JSON.stringify({
                    type: 'user',
                    message: { role: 'user', content: message }
                });
                session.process.stdin.write(jsonMessage + '\n');
            } else {
                // Standard text input for other agents
                session.process.stdin.write(message + '\n');
            }
        } else {
            console.warn(`[AgentManager] Cannot send to ${sessionId}: Process not running`);
            this.emitLog(sessionId, `\r\n[System] Error: Agent process is not running.\r\n`, 'error');
        }
    }

    isRunning(sessionId: string): boolean {
        return this.sessions.has(sessionId);
    }

    getSessionConfig(sessionId: string): AgentConfig | undefined {
        return this.sessions.get(sessionId)?.config;
    }

    listSessions(): string[] {
        return Array.from(this.sessions.keys());
    }
}

// Interface for AgentManager - allows different implementations
export interface IAgentManager {
    startSession(sessionId: string, command: string, config?: Partial<AgentConfig>): void;
    stopSession(sessionId: string): boolean;
    sendToSession(sessionId: string, message: string): void;
    isRunning(sessionId: string): boolean;
    listSessions(): string[];
    on(event: 'log', listener: (payload: AgentLogPayload) => void): void;
}

// Default instance (uses child_process.spawn)
const defaultAgentManager = new AgentManager();

// Current active agent manager instance
let activeAgentManager: IAgentManager = defaultAgentManager;

// Getter for the current agent manager
export const agentManager = {
    get instance(): IAgentManager {
        return activeAgentManager;
    },
    startSession: (sessionId: string, command: string, config?: Partial<AgentConfig>) =>
        activeAgentManager.startSession(sessionId, command, config),
    stopSession: (sessionId: string) =>
        activeAgentManager.stopSession(sessionId),
    sendToSession: (sessionId: string, message: string) =>
        activeAgentManager.sendToSession(sessionId, message),
    isRunning: (sessionId: string) =>
        activeAgentManager.isRunning(sessionId),
    listSessions: () =>
        activeAgentManager.listSessions(),
    on: (event: 'log', listener: (payload: AgentLogPayload) => void) =>
        activeAgentManager.on(event, listener),
};

// Function to set a custom agent manager implementation
export function setAgentManager(manager: IAgentManager) {
    activeAgentManager = manager;
    console.log('[AgentManager] Custom agent manager set');
}

