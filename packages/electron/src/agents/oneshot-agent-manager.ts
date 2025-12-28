import { spawn, type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import * as fs from 'fs/promises';
import * as path from 'path';
import { homedir } from 'os';
import type { AgentConfig, AgentLogPayload } from '@agent-manager/shared';
import { AgentOutputParser } from './output-parser';
import type { IAgentManager } from './agent-manager';
// Removed mcpHub import as we are using native CLI MCP
import {
    AgentDriver,
    AgentDriverContext,
    GeminiDriver,
    ClaudeDriver,
    CodexDriver
} from './drivers';

interface SessionInfo extends AgentDriverContext {
    config: AgentConfig; // Keep config accessible
    buffer: string;
    isProcessing: boolean;
    currentProcess?: ChildProcess;
    pendingHandover?: string;
    pendingToolCall?: { name: string; args: any };
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
            rulesContent: config?.rulesContent,
        };

        this.sessions.set(sessionId, {
            config: agentConfig,
            messageCount: 0,
            buffer: '',
            isProcessing: false,
            sessionId, // From AgentDriverContext
        });
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

    async sendToSession(sessionId: string, message: string) {
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

        let systemPrompt = '';
        if (session.messageCount === 0 && session.config.rulesContent) {
            console.log(`[OneShotAgentManager] Injecting rules for session ${sessionId}`);
            systemPrompt = session.config.rulesContent;
        }

        // We define the internal URL here. Ideally this constant comes from a shared config or server starter.
        const mcpServerUrl = "http://localhost:3001/mcp/sse";

        try {
            const driver = this.getDriver(session.config);
            // Determine if the agent type supports dynamic MCP injection
            const isGemini = session.config.type === 'gemini' || session.config.command === 'gemini';
            const isCodex = session.config.type === 'codex' || session.config.command.startsWith('codex');

            const context: AgentDriverContext = {
                sessionId,
                geminiSessionId: session.geminiSessionId,
                codexThreadId: session.codexThreadId,
                messageCount: session.messageCount,
                mcpServerUrl: (isCodex) ? mcpServerUrl : undefined,
            };

            const cmd = driver.getCommand(context, message, session.config, systemPrompt);

            // Execute the command
            console.log(`[OneShotAgentManager] Running: ${cmd.command} ${cmd.args.join(' ')}`);

            let spawnEnv = { ...process.env, ...session.config.env };

            // If Gemini, prepare a temporary environment with injected config
            // This avoids writing to the user's real ~/.gemini or the project's .gemini
            if (isGemini) {
                const geminiEnv = await this.prepareGeminiEnv(mcpServerUrl);
                spawnEnv = { ...spawnEnv, ...geminiEnv };
            }

            const child = spawn(cmd.command, cmd.args, {
                cwd: session.config.cwd,
                env: spawnEnv,
                shell: true
            });

            session.currentProcess = child;

            let stdout = '';
            let stderr = '';

            if (child.stdout) {
                child.stdout.on('data', (data) => {
                    const str = data.toString();
                    stdout += str;
                    // Stream parse JSON
                    if (session.config.streamJson) {
                        this.parseStreamJson(sessionId, str, session);
                    } else {
                        this.emitLog(sessionId, str, 'text');
                    }
                });
            }

            if (child.stderr) {
                child.stderr.on('data', (data) => {
                    const str = data.toString();
                    stderr += str;
                    // Log stderr but maybe not emit to user interface unless error?
                    // Some tools talk on stderr.
                    console.log(`[OneShotAgentManager ${sessionId}] stderr:`, str);
                    // Optional: this.emitLog(sessionId, str, 'system');
                });
            }

            child.on('close', (code) => {
                session.currentProcess = undefined;
                session.isProcessing = false;
                console.log(`[OneShotAgentManager ${sessionId}] Process exited with code ${code}`);

                if (code !== 0) {
                    this.emitLog(sessionId, `\n[Process exited with code ${code}]\n`, 'system');
                }
            });

            child.on('error', (err) => {
                session.currentProcess = undefined;
                session.isProcessing = false;
                console.error(`[OneShotAgentManager ${sessionId}] Failed to start subprocess.`, err);
                this.emitLog(sessionId, `Failed to start subprocess: ${err.message}`, 'error');
            });

        } catch (error: any) {
            session.isProcessing = false;
            console.error(`[OneShotAgentManager] Error running command:`, error);
            this.emitLog(sessionId, `Error: ${error.message}`, 'error');
        }
    }

    /**
     * Prepares a temporary environment for Gemini to run in.
     * This creates a temporary HOME directory, copies the user's existing settings (auth),
     * and injects the MCP server configuration.
     * This ensures we don't pollute the user's real home or the project directory.
     */
    private async prepareGeminiEnv(mcpServerUrl: string): Promise<NodeJS.ProcessEnv> {
        try {
            const { tmpdir } = await import('os');
            const uniqueId = Math.random().toString(36).substring(7);
            const tempHome = path.join(tmpdir(), `agent-manager-gemini-${uniqueId}`);
            const tempSettingsDir = path.join(tempHome, '.gemini');
            const tempSettingsFile = path.join(tempSettingsDir, 'settings.json');

            await fs.mkdir(tempSettingsDir, { recursive: true });

            const userHome = homedir();
            const userGeminiDir = path.join(userHome, '.gemini');

            // Copy auth-related files to preserve session
            const filesToCopy = [
                'oauth_creds.json',
                'google_accounts.json',
                'installation_id',
                'state.json',
                'settings.json' // Copy this too so we have a base
            ];

            for (const file of filesToCopy) {
                try {
                    await fs.copyFile(
                        path.join(userGeminiDir, file),
                        path.join(tempSettingsDir, file)
                    );
                } catch (e) {
                    // File might not exist, ignore
                }
            }

            let settings: any = { mcpServers: {} };

            try {
                // Read the copied settings.json (or empty if copy failed)
                const content = await fs.readFile(tempSettingsFile, 'utf-8');
                settings = JSON.parse(content);
            } catch (e) {
                // If it wasn't there or invalid, we start with empty settings
            }

            if (!settings.mcpServers) settings.mcpServers = {};

            // Inject MCP Server
            settings.mcpServers['internal-fs'] = {
                url: mcpServerUrl
            };

            // 3. Write to temp config
            await fs.writeFile(tempSettingsFile, JSON.stringify(settings, null, 2));

            // Return env override
            return {
                HOME: tempHome
            };

        } catch (error) {
            console.error('[OneShotAgentManager] Failed to prepare Gemini temp env:', error);
            return {};
        }
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
                throw new Error(`Unknown agent command: ${config.command}`);
        }
    }

    private parseStreamJson(sessionId: string, chunk: string, session: SessionInfo) {
        // This is a simplified stream parser. 
        const lines = chunk.split('\n').filter(l => l.trim().length > 0);
        for (const line of lines) {
            try {
                const json = JSON.parse(line);
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
                // Not valid JSON
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
