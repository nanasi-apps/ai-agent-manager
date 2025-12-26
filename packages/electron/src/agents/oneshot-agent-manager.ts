import { spawn, type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import type { AgentConfig, AgentLogPayload } from '@agent-manager/shared';
import { AgentOutputParser } from './output-parser';
import type { IAgentManager } from './agent-manager';

interface SessionInfo {
    config: AgentConfig;
    messageCount: number;
    buffer: string;
    isProcessing: boolean;
    /** Gemini CLI session ID (UUID) for --resume */
    geminiSessionId?: string;
    /** Codex CLI thread ID for resume */
    codexThreadId?: string;
    /** Current running process (for stopping) */
    currentProcess?: ChildProcess;
}

/**
 * One-shot agent manager for CLIs that work best in non-interactive mode
 * Uses --resume for maintaining conversation context between messages
 */
export class OneShotAgentManager extends EventEmitter implements IAgentManager {
    private sessions: Map<string, SessionInfo> = new Map();
    private parser = new AgentOutputParser();

    startSession(sessionId: string, command: string, config?: Partial<AgentConfig>) {
        if (this.sessions.has(sessionId)) {
            console.warn(`[OneShotAgentManager] Session ${sessionId} already exists.`);
            return;
        }

        console.log(`[OneShotAgentManager] Creating session ${sessionId}`);

        const agentConfig: AgentConfig = {
            type: config?.type ?? 'custom',
            command,
            cwd: config?.cwd,
            env: config?.env,
            streamJson: config?.streamJson ?? false,
            oneShotMode: config?.oneShotMode ?? true,
        };

        this.sessions.set(sessionId, {
            config: agentConfig,
            messageCount: 0,
            buffer: '',
            isProcessing: false,
        });

        this.emitLog(sessionId, '[Session started]\n', 'system');
    }

    sendToSession(sessionId: string, message: string) {
        const session = this.sessions.get(sessionId);
        if (!session) {
            console.warn(`[OneShotAgentManager] Session ${sessionId} not found`);
            this.emitLog(sessionId, '[Error: Session not found]\n', 'error');
            return;
        }

        if (session.isProcessing) {
            console.warn(`[OneShotAgentManager] Session ${sessionId} is busy`);
            this.emitLog(sessionId, '[Waiting for previous response...]\n', 'system');
            return;
        }

        session.isProcessing = true;
        this.runCommand(sessionId, session, message);
    }

    private runCommand(sessionId: string, session: SessionInfo, message: string) {
        const agentType = session.config.type;
        let command: string;
        let args: string[];

        if (agentType === 'gemini') {
            command = 'gemini';
            if (session.messageCount === 0) {
                args = ['-y', '--output-format', 'stream-json', message];
            } else if (session.geminiSessionId) {
                args = ['--resume', session.geminiSessionId, '-y', '--output-format', 'stream-json', message];
            } else {
                console.warn('[OneShotAgentManager] No geminiSessionId stored, using fallback');
                args = ['--resume', 'latest', '-y', '--output-format', 'stream-json', message];
            }
        } else if (agentType === 'claude') {
            command = 'claude';
            args = ['-p', '--output-format', 'stream-json', message];
        } else if (agentType === 'codex') {
            command = 'codex';
            if (session.messageCount === 0) {
                args = ['exec', '--json', '--full-auto', message];
            } else if (session.codexThreadId) {
                args = ['exec', 'resume', '--json', session.codexThreadId, message];
            } else {
                console.warn('[OneShotAgentManager] No codexThreadId stored, using --last fallback');
                args = ['exec', 'resume', '--json', '--last', message];
            }
        } else {
            const parts = session.config.command.split(' ');
            command = parts[0];
            args = [...parts.slice(1), message];
        }

        console.log(`[OneShotAgentManager] Running: ${command} ${args.join(' ')}`);

        const env = {
            ...process.env,
            ...session.config.env,
            TERM: 'dumb',
            NO_COLOR: '1',
        };

        const child = spawn(command, args, {
            cwd: session.config.cwd || process.cwd(),
            env,
            shell: true,
        });

        session.currentProcess = child;

        child.stdout?.on('data', (data: Buffer) => {
            const str = data.toString();
            console.log(`[OneShotAgentManager ${sessionId}] stdout:`, str);

            if (session.config.streamJson) {
                this.parseStreamJson(sessionId, str, session);
            } else {
                this.emitLog(sessionId, str, 'text');
            }
        });

        child.stderr?.on('data', (data: Buffer) => {
            const str = data.toString();
            console.log(`[OneShotAgentManager ${sessionId}] stderr:`, str);
        });

        child.on('close', (code) => {
            console.log(`[OneShotAgentManager ${sessionId}] Process exited with code ${code}`);
            session.isProcessing = false;
            session.messageCount++;

            if (session.buffer) {
                this.parseStreamJson(sessionId, '\n', session);
            }
        });

        child.on('error', (err) => {
            console.error(`[OneShotAgentManager ${sessionId}] Process error:`, err);
            this.emitLog(sessionId, `[Error: ${err.message}]\n`, 'error');
            session.isProcessing = false;
        });
    }

    private parseStreamJson(sessionId: string, data: string, session: SessionInfo) {
        session.buffer += data;

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
                    if (log.metadata?.geminiSessionId) {
                        session.geminiSessionId = log.metadata.geminiSessionId;
                        console.log(`[OneShotAgentManager] Captured Gemini session ID: ${session.geminiSessionId}`);
                    }

                    if (log.metadata?.codexThreadId) {
                        session.codexThreadId = log.metadata.codexThreadId;
                        console.log(`[OneShotAgentManager] Captured Codex thread ID: ${session.codexThreadId}`);
                    }

                    this.emitLog(sessionId, log.data, log.type, log.raw);
                }
            } catch {
                // Not valid JSON, ignore
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
            if (session.currentProcess) {
                session.currentProcess.kill();
                session.isProcessing = false;
            }
            this.emitLog(sessionId, '\n[Generation stopped by user]\n', 'system');
            return true;
        }
        return false;
    }

    isRunning(sessionId: string): boolean {
        return this.sessions.has(sessionId);
    }

    listSessions(): string[] {
        return Array.from(this.sessions.keys());
    }
}

export const oneShotAgentManager = new OneShotAgentManager();
