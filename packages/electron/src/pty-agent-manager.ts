import * as pty from 'node-pty';
import { EventEmitter } from 'node:events';
import type { AgentConfig, AgentType } from '@agent-manager/shared';
import { AgentOutputParser, type AgentLogPayload } from './agent-output-parser';



interface SessionInfo {
    pty: pty.IPty;
    config: AgentConfig;
    buffer: string;
    ready: boolean;
    messageQueue: string[];
}

export class PtyAgentManager extends EventEmitter {
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
            cwd: config?.cwd,
            env: config?.env,
            streamJson: config?.streamJson ?? false,
        };

        try {
            // Determine shell based on platform
            const shell = process.platform === 'win32' ? 'powershell.exe' : process.env.SHELL || '/bin/zsh';

            // Merge environment variables
            const env: Record<string, string> = {
                ...process.env as Record<string, string>,
                ...agentConfig.env,
                TERM: 'xterm-256color',
                COLORTERM: 'truecolor',
                FORCE_COLOR: '3',
            };

            // Create PTY process
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
            };

            this.sessions.set(sessionId, sessionInfo);

            // Handle PTY output
            ptyProcess.onData((data: string) => {
                this.handleOutput(sessionId, data);
            });

            ptyProcess.onExit(({ exitCode }) => {
                this.emitLog(sessionId, `\r\n[Process exited with code ${exitCode}]\r\n`, 'system');
                this.sessions.delete(sessionId);
            });

            // Send the command to the PTY after a brief delay to let it initialize
            setTimeout(() => {
                ptyProcess.write(`${command}\r`);

                // Mark as ready after command is sent and wait a bit more for the agent to initialize
                setTimeout(() => {
                    const session = this.sessions.get(sessionId);
                    if (session) {
                        session.ready = true;
                        // Process any queued messages
                        while (session.messageQueue.length > 0) {
                            const msg = session.messageQueue.shift();
                            if (msg) {
                                console.log(`[PtyAgentManager] Sending queued message: ${msg.substring(0, 50)}...`);
                                session.pty.write(msg + '\r');
                            }
                        }
                    }
                }, 2000); // Wait 2 seconds for the agent to be ready
            }, 100);
        } catch (error) {
            console.error(`[PtyAgentManager] Failed to start session ${sessionId}:`, error);
            this.emitLog(sessionId, `\r\n[Error starting PTY: ${error}]\r\n`, 'error');
            throw error;
        }
    }

    private handleOutput(sessionId: string, data: string) {
        const session = this.sessions.get(sessionId);
        if (!session) return;

        // Log all raw output to console for debugging
        console.log(`[PTY ${sessionId}] Raw output:`, data);

        // If using stream-json format, parse and filter
        if (session.config.streamJson) {
            this.parseStreamJson(sessionId, data, session);
        } else {
            // Raw output mode - emit as-is
            this.emitLog(sessionId, data, 'text');
        }
    }

    private parseStreamJson(sessionId: string, data: string, session: SessionInfo) {
        // Strip ANSI escape codes
        const cleanData = this.stripAnsi(data);

        // Append to buffer
        session.buffer += cleanData;

        // Process complete lines
        const lines = session.buffer.split('\n');
        session.buffer = lines.pop() || '';

        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;

            // Skip lines that don't look like JSON (start with { or [)
            if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
                continue;
            }

            try {
                const json = JSON.parse(trimmed);
                const logs = this.parser.processJsonEvent(json, session.config.type);

                for (const log of logs) {
                    this.emitLog(sessionId, log.data, log.type, log.raw);
                }
            } catch {
                // Not valid JSON, silently ignore in stream-json mode
            }
        }
    }

    // Strip ANSI escape codes from output
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

    stopSession(sessionId: string) {
        const session = this.sessions.get(sessionId);
        if (session) {
            session.pty.kill();
            this.sessions.delete(sessionId);
            this.emitLog(sessionId, `\r\n[Process killed by user]\r\n`, 'system');
        }
    }

    sendToSession(sessionId: string, message: string) {
        const session = this.sessions.get(sessionId);
        if (session) {
            if (session.ready) {
                // Session is ready, send immediately
                console.log(`[PtyAgentManager] Sending message: ${message.substring(0, 50)}...`);
                session.pty.write(message + '\r');
            } else {
                // Session not ready, queue the message
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

    // Resize PTY if needed
    resizeSession(sessionId: string, cols: number, rows: number) {
        const session = this.sessions.get(sessionId);
        if (session) {
            session.pty.resize(cols, rows);
        }
    }
}

export const ptyAgentManager = new PtyAgentManager();
