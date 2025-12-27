import { spawn, type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import type { AgentConfig, AgentLogPayload } from '@agent-manager/shared';
import { AgentOutputParser } from './output-parser';
import type { IAgentManager } from './agent-manager';
import {
    AgentDriver,
    AgentDriverContext,
    GeminiDriver,
    ClaudeDriver,
    CodexDriver,
    CustomDriver
} from './drivers';

interface SessionInfo extends AgentDriverContext {
    config: AgentConfig; // Keep config accessible
    buffer: string;
    isProcessing: boolean;
    currentProcess?: ChildProcess;
    pendingHandover?: string;
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
            model: config?.model,
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
            sessionId, // From AgentDriverContext
        });

        // this.emitLog(sessionId, '[Session started]\n', 'system');
    }

    resetSession(sessionId: string, command: string, config?: Partial<AgentConfig>) {
        const session = this.sessions.get(sessionId);
        if (!session) {
            this.startSession(sessionId, command, config);
            return;
        }

        const nextType = config?.type ?? session.config.type;
        const shouldResetState = session.config.type !== nextType;

        if (session.currentProcess) {
            session.currentProcess.kill();
            session.currentProcess = undefined;
        }

        session.isProcessing = false;
        session.buffer = '';
        session.config = {
            ...session.config,
            ...config,
            type: nextType,
            command,
        };

        if (shouldResetState) {
            session.messageCount = 0;
            session.geminiSessionId = undefined;
            session.codexThreadId = undefined;
        }
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

    private getDriver(config: AgentConfig): AgentDriver {
        switch (config.type) {
            case 'gemini':
                return new GeminiDriver();
            case 'claude':
                return new ClaudeDriver();
            case 'codex':
                return new CodexDriver();
            default:
                return new CustomDriver(config);
        }
    }

    private runCommand(sessionId: string, session: SessionInfo, message: string) {
        const driver = this.getDriver(session.config);
        const { command, args } = driver.getCommand(session, message, session.config);

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
            // console.log(`[OneShotAgentManager ${sessionId}] stdout:`, str);

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

    getSessionMetadata(sessionId: string): { geminiSessionId?: string, codexThreadId?: string } | undefined {
        const session = this.sessions.get(sessionId);
        if (!session) return undefined;
        return {
            geminiSessionId: session.geminiSessionId,
            codexThreadId: session.codexThreadId,
        };
    }

    setPendingHandover(sessionId: string, context: string) {
        const session = this.sessions.get(sessionId);
        if (session) {
            session.pendingHandover = context;
        }
    }

    consumePendingHandover(sessionId: string): string | undefined {
        const session = this.sessions.get(sessionId);
        if (!session || !session.pendingHandover) return undefined;

        const context = session.pendingHandover;
        session.pendingHandover = undefined;
        return context;
    }
}

export const oneShotAgentManager = new OneShotAgentManager();
