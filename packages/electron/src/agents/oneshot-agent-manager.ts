import { spawn, type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import * as fs from 'fs/promises';
import { statSync } from 'node:fs';
import * as path from 'path';
import { homedir } from 'os';
import type { AgentConfig, AgentLogPayload } from '@agent-manager/shared';
import { AgentOutputParser } from './output-parser';
import type { IAgentManager, WorktreeResumeRequest } from './agent-manager';
// Removed mcpHub import as we are using native CLI MCP
import {
    AgentDriver,
    AgentDriverContext,
    GeminiDriver,
    ClaudeDriver,
    CodexDriver
} from './drivers';

interface PendingWorktreeResume {
    request: WorktreeResumeRequest;
    resumeMessage: string;
}

interface ActiveWorktreeContext {
    cwd: string;
    branch: string;
    repoPath: string;
}

interface SessionInfo extends AgentDriverContext {
    config: AgentConfig; // Keep config accessible
    buffer: string;
    isProcessing: boolean;
    currentProcess?: ChildProcess;
    pendingHandover?: string;
    pendingToolCall?: { name: string; args: any };
    projectRoot?: string;
    lastUserMessage?: string;
    pendingWorktreeResume?: PendingWorktreeResume;
    activeWorktree?: ActiveWorktreeContext;
    geminiHome?: string;
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
            projectRoot: agentConfig.cwd,
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

        const previousProjectRoot = session.projectRoot ?? session.config.cwd;

        session.isProcessing = false;
        session.buffer = '';
        session.config = {
            ...session.config,
            ...config,
            type: nextType,
            command,
        };
        session.projectRoot = previousProjectRoot ?? session.config.cwd;
        session.pendingWorktreeResume = undefined;

        if (shouldResetState) {
            session.messageCount = 0;
            session.geminiSessionId = undefined;
            session.codexThreadId = undefined;
            session.lastUserMessage = undefined;
            session.geminiHome = undefined;
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
        session.lastUserMessage = message;

        await this.validateActiveWorktree(sessionId, session);

        let systemPrompt = '';
        if (session.messageCount === 0) {
            const baseRules = session.config.rulesContent ?? '';
            const worktreeInstructions = this.buildWorktreeInstructions(session);
            const parts = [baseRules, worktreeInstructions].filter(Boolean);
            systemPrompt = parts.join('\n\n');
            if (baseRules) {
                console.log(`[OneShotAgentManager] Injecting rules for session ${sessionId}`);
            }
        }
        const messageToSend = this.appendWorktreeReminder(session, message);

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

            const cmd = driver.getCommand(context, messageToSend, session.config, systemPrompt);

            // Execute the command
            console.log(`[OneShotAgentManager] Running: ${cmd.command} ${cmd.args.join(' ')}`);

            let spawnEnv = { ...process.env, ...session.config.env };

            // If Gemini, prepare a temporary environment with injected config
            // This avoids writing to the user's real ~/.gemini or the project's .gemini
            if (isGemini) {
                const geminiEnv = await this.prepareGeminiEnv(mcpServerUrl, session.geminiHome);
                if (geminiEnv.HOME) {
                    session.geminiHome = geminiEnv.HOME;
                }
                spawnEnv = { ...spawnEnv, ...geminiEnv };
            }

            // Safety check for CWD
            if (session.config.cwd) {
                try {
                    await fs.access(session.config.cwd);
                } catch (error) {
                    console.error(`[OneShotAgentManager] CWD ${session.config.cwd} does not exist.`);
                    if (session.projectRoot && session.projectRoot !== session.config.cwd) {
                        console.log(`[OneShotAgentManager] Falling back to project root: ${session.projectRoot}`);
                        this.emitLog(sessionId, `[Warning] Worktree directory ${session.config.cwd} not found. Falling back to project root.\n`, 'system');
                        session.config.cwd = session.projectRoot;
                        // Clear invalid active worktree
                        if (session.activeWorktree?.cwd === session.config.cwd) {
                            session.activeWorktree = undefined;
                        }
                    } else {
                        this.emitLog(sessionId, `[Error] CWD ${session.config.cwd} does not exist and no valid fallback.\n`, 'error');
                        session.isProcessing = false;
                        return;
                    }
                }
            }

            const resolvedCwd = await this.resolveSessionCwd(sessionId, session);

            const child = spawn(cmd.command, cmd.args, {
                cwd: resolvedCwd,
                env: spawnEnv,
                shell: true
            });

            session.currentProcess = child;
            session.messageCount += 1;

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

                    // Detect Gemini's "Invalid session identifier" error and clear the stale session ID
                    if (str.includes('Invalid session identifier') || str.includes('No previous sessions found')) {
                        if (session.geminiSessionId) {
                            console.warn(`[OneShotAgentManager ${sessionId}] Gemini session ${session.geminiSessionId} is invalid, clearing it.`);
                            session.geminiSessionId = undefined;
                        }
                    }
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
                this.handlePendingWorktreeResume(sessionId);
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

    requestWorktreeResume(sessionId: string, request: WorktreeResumeRequest): boolean {
        const session = this.sessions.get(sessionId);
        if (!session) {
            console.warn(`[OneShotAgentManager] Worktree resume requested for missing session ${sessionId}`);
            return false;
        }

        try {
            if (!statSync(request.cwd).isDirectory()) {
                throw new Error('Worktree path is not a directory.');
            }
        } catch (error: any) {
            const message = error?.message || String(error);
            this.emitLog(
                sessionId,
                `\n[System] Worktree resume blocked: ${message}\n`,
                'system'
            );
            return false;
        }

        const resumeMessage = request.resumeMessage ?? this.buildWorktreeResumeMessage(session, request);
        session.pendingWorktreeResume = {
            request,
            resumeMessage,
        };
        this.emitLog(
            sessionId,
            `\n[System] Worktree resume scheduled for branch ${request.branch}.\n`,
            'system'
        );
        return true;
    }

    /**
     * Prepares a temporary environment for Gemini to run in.
     * This creates a temporary HOME directory, copies the user's existing settings (auth),
     * and injects the MCP server configuration.
     * This ensures we don't pollute the user's real home or the project directory.
     */
    private async prepareGeminiEnv(mcpServerUrl: string, existingHome?: string): Promise<NodeJS.ProcessEnv> {
        try {
            const { tmpdir } = await import('os');
            if (existingHome) {
                await this.ensureGeminiSettings(existingHome, mcpServerUrl, false);
                return { HOME: existingHome };
            }

            const uniqueId = Math.random().toString(36).substring(7);
            const tempHome = path.join(tmpdir(), `agent-manager-gemini-${uniqueId}`);
            await this.ensureGeminiSettings(tempHome, mcpServerUrl, true);

            return { HOME: tempHome };
        } catch (error) {
            console.error('[OneShotAgentManager] Failed to prepare Gemini temp env:', error);
            return {};
        }
    }

    private async ensureGeminiSettings(
        homeDir: string,
        mcpServerUrl: string,
        copyAuth: boolean
    ): Promise<void> {
        const settingsDir = path.join(homeDir, '.gemini');
        const settingsFile = path.join(settingsDir, 'settings.json');

        await fs.mkdir(settingsDir, { recursive: true });

        if (copyAuth) {
            const userHome = homedir();
            const userGeminiDir = path.join(userHome, '.gemini');

            const filesToCopy = [
                'oauth_creds.json',
                'google_accounts.json',
                'installation_id',
                'state.json',
                'settings.json'
            ];

            for (const file of filesToCopy) {
                try {
                    await fs.copyFile(
                        path.join(userGeminiDir, file),
                        path.join(settingsDir, file)
                    );
                } catch (e) {
                    // File might not exist, ignore
                }
            }
        }

        let settings: any = { mcpServers: {} };
        try {
            const content = await fs.readFile(settingsFile, 'utf-8');
            settings = JSON.parse(content);
        } catch (e) {
            // If it wasn't there or invalid, we start with empty settings
        }

        if (!settings.mcpServers) settings.mcpServers = {};
        settings.mcpServers['agents-manager-mcp'] = { url: mcpServerUrl };

        await fs.writeFile(settingsFile, JSON.stringify(settings, null, 2));
    }

    private buildWorktreeInstructions(session: SessionInfo): string {
        const projectRoot = session.projectRoot ?? session.config.cwd ?? '';
        const branchSuggestion = `agent/${session.sessionId.slice(0, 8)}`;
        const lines = [
            '[Agent Manager Context]',
            `Session ID: ${session.sessionId}`,
        ];
        if (projectRoot) {
            lines.push(`Project root: ${projectRoot}`);
        }
        if (session.activeWorktree) {
            lines.push(`Active worktree: ${session.activeWorktree.branch} (${session.activeWorktree.cwd})`);
        }
        lines.push('Worktree workflow:');
        lines.push('- If the task involves code changes, tests, or file edits, create a worktree first.');
        lines.push('- Only skip for pure Q/A that does not touch the repo.');
        lines.push(`- Use repoPath = Project root. Suggested branch: ${branchSuggestion}.`);
        lines.push('- Call MCP tool "worktree_create" with { repoPath, branch, sessionId, resume: true }.');
        lines.push('- After calling, stop and wait. The host will resume you with cwd switched to that worktree.');
        lines.push('- If you are already in a worktree, do not request another one.');
        return lines.join('\n');
    }

    private appendWorktreeReminder(session: SessionInfo, message: string): string {
        if (session.messageCount === 0 || session.activeWorktree) {
            return message;
        }

        const projectRoot = session.projectRoot ?? session.config.cwd ?? '';
        const branchSuggestion = `agent/${session.sessionId.slice(0, 8)}`;
        const reminderLines = [
            '[Worktree Reminder]',
            `Session ID: ${session.sessionId}`,
        ];
        if (projectRoot) {
            reminderLines.push(`Project root: ${projectRoot}`);
        }
        reminderLines.push('If this task involves code changes, create a worktree first.');
        reminderLines.push(`Use repoPath = Project root, branch = ${branchSuggestion}.`);
        reminderLines.push('Call tool: worktree_create({ repoPath, branch, sessionId, resume: true }) then wait.');
        return `${reminderLines.join('\n')}\n\n${message}`;
    }

    private buildWorktreeResumeMessage(session: SessionInfo, request: WorktreeResumeRequest): string {
        const projectRoot = session.projectRoot ?? request.repoPath;
        const originalMessage = session.lastUserMessage ?? '';
        const lines = [
            '[SYSTEM CONTEXT]',
            'Worktree created and activated for this session.',
            `Branch: ${request.branch}`,
            `Worktree path: ${request.cwd}`,
        ];
        if (projectRoot) {
            lines.push(`Project root: ${projectRoot}`);
        }
        lines.push('Continue the original task from the worktree. Do not create another worktree unless needed.');
        if (originalMessage) {
            lines.push('', 'Original request:', originalMessage);
        }
        return lines.join('\n');
    }

    private handlePendingWorktreeResume(sessionId: string) {
        const session = this.sessions.get(sessionId);
        if (!session || session.isProcessing) return;
        const pending = session.pendingWorktreeResume;
        if (!pending) return;

        session.pendingWorktreeResume = undefined;
        session.activeWorktree = {
            cwd: pending.request.cwd,
            branch: pending.request.branch,
            repoPath: pending.request.repoPath,
        };
        session.config.cwd = pending.request.cwd;

        this.emitLog(
            sessionId,
            `\n[System] Switching to worktree ${pending.request.branch} at ${pending.request.cwd}\n`,
            'system'
        );

        void this.sendToSession(sessionId, pending.resumeMessage);
    }

    private async resolveSessionCwd(sessionId: string, session: SessionInfo): Promise<string | undefined> {
        const requestedCwd = session.config.cwd;
        if (requestedCwd && await this.pathExists(requestedCwd)) {
            return requestedCwd;
        }

        const fallbackCwd = session.projectRoot;
        if (fallbackCwd && await this.pathExists(fallbackCwd)) {
            if (requestedCwd) {
                session.config.cwd = fallbackCwd;
                if (session.activeWorktree) {
                    session.activeWorktree = undefined;
                }
                this.emitLog(
                    sessionId,
                    `\n[System] Worktree path not found. Falling back to ${fallbackCwd}\n`,
                    'system'
                );
            }
            return fallbackCwd;
        }

        if (requestedCwd) {
            this.emitLog(
                sessionId,
                `\n[System] Working directory not found: ${requestedCwd}. Using default cwd.\n`,
                'system'
            );
        }

        return undefined;
    }

    private async validateActiveWorktree(sessionId: string, session: SessionInfo): Promise<void> {
        if (!session.activeWorktree) return;
        const cwd = session.config.cwd;
        if (cwd && await this.pathExists(cwd)) return;

        session.activeWorktree = undefined;
        const fallback = session.projectRoot;
        if (fallback) {
            session.config.cwd = fallback;
        }
        this.emitLog(
            sessionId,
            `\n[System] Worktree path missing. Worktree context cleared.\n`,
            'system'
        );
    }

    private async pathExists(targetPath: string): Promise<boolean> {
        try {
            const stats = await fs.stat(targetPath);
            return stats.isDirectory();
        } catch {
            return false;
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
