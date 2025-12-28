import * as pty from 'node-pty';
import { EventEmitter } from 'node:events';
import type { AgentConfig, AgentLogPayload } from '@agent-manager/shared';
import { AgentOutputParser } from './output-parser';
import type { IAgentManager } from './agent-manager';
import { mcpHub } from '../mcp-hub';
import { getMcpToolInstructions, executeMcpTool } from './mcp-utils';

interface SessionInfo {
    pty: pty.IPty;
    config: AgentConfig;
    buffer: string;
    ready: boolean;
    messageQueue: string[];
    messageCount: number;
}

/**
 * PTY-based agent manager for interactive CLI sessions
 * Uses node-pty for terminal emulation
 */
export class PtyAgentManager extends EventEmitter implements IAgentManager {
    private sessions: Map<string, SessionInfo> = new Map();
    private parser = new AgentOutputParser();

    startSession(sessionId: string, command: string, config?: Partial<AgentConfig>) {
        if (this.sessions.has(sessionId)) {
            console.warn(`[PtyAgentManager] Session ${sessionId} is already running.`);
            return;
        }

        console.log(`[PtyAgentManager] Starting PTY session ${sessionId}: ${command}`);

        const agentConfig: AgentConfig = {
            type: config?.type ?? 'custom',
            command,
            model: config?.model,
            cwd: config?.cwd,
            env: config?.env,
            streamJson: config?.streamJson ?? false,
            rulesContent: config?.rulesContent,
        };

        try {
            const shell = process.platform === 'win32' ? 'powershell.exe' : process.env.SHELL || '/bin/zsh';

            const env: Record<string, string> = {
                ...process.env as Record<string, string>,
                ...agentConfig.env,
                TERM: 'xterm-256color',
                COLORTERM: 'truecolor',
                FORCE_COLOR: '3',
            };

            const ptyProcess = pty.spawn(shell, [], {
                name: 'xterm-256color',
                cols: 120,
                rows: 30,
                cwd: agentConfig.cwd || process.cwd(),
                env,
            });

            const sessionInfo: SessionInfo = {
                pty: ptyProcess,
                config: agentConfig,
                buffer: '',
                ready: false,
                messageQueue: [],
                messageCount: 0,
            };

            this.sessions.set(sessionId, sessionInfo);

            ptyProcess.onData((data: string) => {
                this.handleOutput(sessionId, data);
            });

            ptyProcess.onExit(({ exitCode }) => {
                this.emitLog(sessionId, `\r\n[Process exited with code ${exitCode}]\r\n`, 'system');
                this.sessions.delete(sessionId);
            });

            setTimeout(() => {
                ptyProcess.write(`${command}\r`);

                setTimeout(() => {
                    const session = this.sessions.get(sessionId);
                    if (session) {
                        session.ready = true;
                        while (session.messageQueue.length > 0) {
                            const msg = session.messageQueue.shift();
                            if (msg) {
                                console.log(`[PtyAgentManager] Sending queued message: ${msg.substring(0, 50)}...`);
                                // Since we don't know the message count when queuing (it might be the first message),
                                // check here if it's the first.
                                let finalMsg = msg;
                                if (session.messageCount === 0 && session.config.rulesContent) {
                                    console.log(`[PtyAgentManager] Injecting rules for session ${sessionId} (queued)`);
                                    finalMsg = `${session.config.rulesContent}\n\n${msg}`;
                                }
                                session.pty.write(finalMsg + '\r');
                                session.messageCount++;
                            }
                        }
                    }
                }, 2000);
            }, 100);
        } catch (error) {
            console.error(`[PtyAgentManager] Failed to start session ${sessionId}:`, error);
            this.emitLog(sessionId, `\r\n[Error starting PTY: ${error}]\r\n`, 'error');
            throw error;
        }
    }

    resetSession(sessionId: string, command: string, config?: Partial<AgentConfig>) {
        if (this.sessions.has(sessionId)) {
            this.stopSession(sessionId);
        }
        this.startSession(sessionId, command, config);
    }

    private handleOutput(sessionId: string, data: string) {
        const session = this.sessions.get(sessionId);
        if (!session) return;

        console.log(`[PTY ${sessionId}] Raw output:`, data);

        if (session.config.streamJson) {
            this.parseStreamJson(sessionId, data, session);
        } else {
            this.emitLog(sessionId, data, 'text');
        }
    }

    private parseStreamJson(sessionId: string, data: string, session: SessionInfo) {
        const cleanData = this.stripAnsi(data);
        session.buffer += cleanData;

        const lines = session.buffer.split('\n');
        session.buffer = lines.pop() || '';

        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) continue;

            try {
                const json = JSON.parse(trimmed);
                const logs = this.parser.processJsonEvent(json, session.config.type);

                for (const log of logs) {
                    this.emitLog(sessionId, log.data, log.type, log.raw);

                    if (log.type === 'tool_call' && log.raw) {
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        const raw = log.raw as any;
                        const toolName = raw.tool_name || raw.name || raw.tool;
                        const args = raw.parameters || raw.arguments || raw.input || {};

                        if (toolName) {
                            this.emitLog(sessionId, `\n[Executing Tool: ${toolName}...]\n`, 'system');

                            // Async execution
                            executeMcpTool(toolName, args).then(result => {
                                this.emitLog(sessionId, `[Tool Result]\n${result}\n`, 'tool_result');

                                // Feed result back to PTY
                                const toolResultMessage = `[Tool Result for ${toolName}]\n${result}`;
                                session.pty.write(toolResultMessage + '\r');
                                session.messageCount++;
                            }).catch(err => {
                                console.error(`[PtyAgentManager] Tool execution failed:`, err);
                                this.emitLog(sessionId, `[Error executing tool: ${err}]\n`, 'error');
                            });
                        }
                    }
                }
            } catch {
                // Not valid JSON, silently ignore
            }
        }
    }

    private stripAnsi(str: string): string {
        // eslint-disable-next-line no-control-regex
        return str.replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, '');
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
            session.pty.kill();
            this.sessions.delete(sessionId);
            this.emitLog(sessionId, `\r\n[Process killed by user]\r\n`, 'system');
            return true;
        }
        return false;
    }

    async sendToSession(sessionId: string, message: string) {
        const session = this.sessions.get(sessionId);
        if (session) {
            if (session.messageCount === 0) {
                 try {
                     const mcpInstructions = await getMcpToolInstructions();
                     if (mcpInstructions) {
                        if (session.config.rulesContent) {
                             session.config.rulesContent += mcpInstructions;
                        } else {
                             session.config.rulesContent = mcpInstructions;
                        }
                     }
                 } catch (e) {
                     console.error('Failed to fetch MCP tools', e);
                 }
            }

            if (session.ready) {
                console.log(`[PtyAgentManager] Sending message: ${message.substring(0, 50)}...`);
                let finalMsg = message;
                if (session.messageCount === 0 && session.config.rulesContent) {
                    console.log(`[PtyAgentManager] Injecting rules for session ${sessionId}`);
                    finalMsg = `${session.config.rulesContent}\n\n${message}`;
                }
                session.pty.write(finalMsg + '\r');
                session.messageCount++;
            } else {
                console.log(`[PtyAgentManager] Queueing message (session not ready): ${message.substring(0, 50)}...`);
                session.messageQueue.push(message);
            }
        } else {
            console.warn(`[PtyAgentManager] Cannot send to ${sessionId}: Session not running`);
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

    resizeSession(sessionId: string, cols: number, rows: number) {
        const session = this.sessions.get(sessionId);
        if (session) {
            session.pty.resize(cols, rows);
        }
    }
}

export const ptyAgentManager = new PtyAgentManager();
