
import { spawn, type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import * as fs from 'fs/promises';
import { statSync } from 'node:fs';
import type { AgentConfig, AgentLogPayload } from '@agent-manager/shared';
import { AgentOutputParser } from './output-parser';
import { SessionStateManager, type SessionState } from './session-state-manager';
import type { WorktreeResumeRequest } from './agent-manager';
import {
    AgentDriver,
    AgentDriverContext,
    GeminiDriver,
    ClaudeDriver,
    CodexDriver
} from './drivers';
import { prepareGeminiEnv, prepareClaudeEnv, prepareCodexEnv } from './env-utils';

export class OneShotSession extends EventEmitter {
    private stateManager: SessionStateManager;
    private parser: AgentOutputParser;

    constructor(
        public readonly sessionId: string,
        config: AgentConfig
    ) {
        super();
        this.stateManager = new SessionStateManager(sessionId, config);
        this.parser = new AgentOutputParser();
    }

    get state(): SessionState {
        return this.stateManager.get();
    }

    get config(): AgentConfig {
        return this.state.config;
    }

    get isProcessing(): boolean {
        return this.state.isProcessing;
    }

    updateConfig(config: Partial<AgentConfig>) {
        this.stateManager.updateConfig(config);
    }

    resetStateForNewType(config: AgentConfig) {
        this.stateManager.resetStateForNewType(config);
    }

    resetStateSoft(config: Partial<AgentConfig>) {
        this.stateManager.resetStateSoft(config);
    }

    stop() {
        this.stateManager.stopProcessing();
        this.stateManager.clearWorktreeResume();
        this.emitLog('\n[Generation stopped by user]\n', 'system');
    }

    requestWorktreeResume(request: WorktreeResumeRequest): boolean {
        try {
            if (!statSync(request.cwd).isDirectory()) {
                throw new Error('Worktree path is not a directory.');
            }
        } catch (error: any) {
            const message = error?.message || String(error);
            this.emitLog(`\n[System] Worktree resume blocked: ${message}\n`, 'system');
            return false;
        }

        const resumeMessage = request.resumeMessage ?? this.buildWorktreeResumeMessage(request);
        this.stateManager.setWorktreeResume({
            request,
            resumeMessage,
        });

        this.emitLog(`\n[System] Worktree resume scheduled for branch ${request.branch}.\n`, 'system');
        return true;
    }

    setPendingHandover(context: string) {
        this.stateManager.setPendingHandover(context);
    }

    consumePendingHandover(): string | undefined {
        return this.stateManager.consumePendingHandover();
    }

    async processMessage(message: string) {
        if (this.isProcessing) {
            console.warn(`[OneShotSession] Session ${this.sessionId} is busy`);
            this.emitLog('[Waiting for previous response...]\n', 'system');
            return;
        }

        await this.validateActiveWorktree();

        // Re-get state after validation checks
        const currentState = this.state;

        let systemPrompt = '';
        if (currentState.messageCount === 0) {
            this.stateManager.resetInvalidGeminiSession();

            const baseRules = currentState.config.rulesContent ?? '';
            const worktreeInstructions = this.buildWorktreeInstructions();
            const parts = [baseRules, worktreeInstructions].filter(Boolean);
            systemPrompt = parts.join('\n\n');
            if (baseRules) {
                console.log(`[OneShotSession] Injecting rules for session ${this.sessionId}`);
            }
        }

        const messageToSend = this.appendWorktreeReminder(message);

        // TODO: Move to shared config
        const mcpServerUrl = "http://localhost:3001/mcp/sse";

        try {
            const driver = this.getDriver(currentState.config);
            const isGemini = this.isAgentType(currentState.config, 'gemini');
            const isCodex = this.isAgentType(currentState.config, 'codex');
            const isClaude = this.isAgentType(currentState.config, 'claude');

            const context: AgentDriverContext = {
                sessionId: this.sessionId,
                geminiSessionId: currentState.geminiSessionId,
                codexThreadId: currentState.codexThreadId,
                messageCount: currentState.messageCount,
                mcpServerUrl: (isCodex || isGemini || isClaude) ? mcpServerUrl : undefined,
            };

            const cmd = driver.getCommand(context, messageToSend, currentState.config, systemPrompt);

            // Execute the command
            console.log(`[OneShotSession] Running: ${cmd.command} ${cmd.args.join(' ')}`);

            const spawnEnv = await this.prepareEnvironment(currentState, mcpServerUrl, isGemini, isCodex, isClaude);
            const resolvedCwd = await this.resolveSessionCwd();

            // Safety check if CWD resolution failed/warned but we assume it might work or we shouldn't proceed?
            // resolveSessionCwd emits logs if fails, returns undefined if strictly failed.
            if (currentState.config.cwd && !resolvedCwd) {
                // If config.cwd was set but resolvedCwd is undefined, it means strictly failed and fallback didn't work
                // The logs are already emitted by resolveSessionCwd
                return;
            }

            const finalCwd = resolvedCwd || currentState.config.cwd; // Fallback to config if resolving returned undefined (default)

            const child = spawn(cmd.command, cmd.args, {
                cwd: finalCwd,
                env: spawnEnv,
                shell: true
            });

            this.stateManager.startProcessing(child, message);
            this.stateManager.incrementMessageCount();

            this.handleProcessOutput(child);

            child.on('close', (code) => {
                this.handleProcessClose(child, code);
            });

            child.on('error', (err) => {
                this.stateManager.stopProcessing();
                console.error(`[OneShotSession ${this.sessionId}] Failed to start subprocess.`, err);
                this.emitLog(`Failed to start subprocess: ${err.message}`, 'error');
            });

        } catch (error: any) {
            this.stateManager.stopProcessing();
            console.error(`[OneShotSession] Error running command:`, error);
            this.emitLog(`Error: ${error.message}`, 'error');
        }
    }

    private isAgentType(config: AgentConfig, type: 'gemini' | 'codex' | 'claude'): boolean {
        if (config.type === type) return true;
        if (type === 'gemini') return config.command === 'gemini' || config.command.startsWith('gemini ');
        if (type === 'codex') return config.command.startsWith('codex');
        if (type === 'claude') return config.command === 'claude' || config.command.startsWith('claude ');
        return false;
    }

    private async prepareEnvironment(
        state: SessionState,
        mcpServerUrl: string,
        isGemini: boolean,
        isCodex: boolean,
        isClaude: boolean
    ): Promise<NodeJS.ProcessEnv> {
        let spawnEnv = { ...process.env, ...state.config.env };

        if (isGemini) {
            const geminiEnv = await prepareGeminiEnv({
                mcpServerUrl,
                existingHome: state.geminiHome,
                apiKey: state.config.env?.GEMINI_API_KEY,
                baseUrl: state.config.env?.GOOGLE_GEMINI_BASE_URL,
            });
            if (geminiEnv.HOME) {
                this.stateManager.setGeminiHome(geminiEnv.HOME);
            }
            spawnEnv = { ...spawnEnv, ...geminiEnv };
        }

        if (isCodex) {
            const codexEnv = prepareCodexEnv({
                apiKey: state.config.env?.OPENAI_API_KEY,
                baseUrl: state.config.env?.OPENAI_BASE_URL,
            });
            spawnEnv = { ...spawnEnv, ...codexEnv };
        }

        if (isClaude) {
            const claudeEnv = await prepareClaudeEnv(mcpServerUrl, state.claudeHome);
            if (claudeEnv.CLAUDE_CONFIG_DIR) {
                this.stateManager.setClaudeHome(claudeEnv.CLAUDE_CONFIG_DIR);
            }
            spawnEnv = { ...spawnEnv, ...claudeEnv };
        }

        return spawnEnv;
    }

    private handleProcessOutput(child: ChildProcess) {
        if (child.stdout) {
            child.stdout.on('data', (data) => {
                const str = data.toString();
                if (this.state.config.streamJson) {
                    this.parseStreamJson(str);
                } else {
                    this.emitLog(str, 'text');
                }
            });
        }

        if (child.stderr) {
            child.stderr.on('data', (data) => {
                const str = data.toString();
                console.log(`[OneShotSession ${this.sessionId}] stderr:`, str);
                this.checkForErrors(child, str);
            });
        }
    }

    private handleProcessClose(child: ChildProcess, code: number | null) {
        if (this.state.currentProcess !== child) return;

        this.stateManager.stopProcessing();
        console.log(`[OneShotSession ${this.sessionId}] Process exited with code ${code}`);

        if (!this.state.pendingWorktreeResume) {
            this.emitLog(`\n[Process exited with code ${code}]\n`, 'system');
        }
        this.handlePendingWorktreeResume();
    }

    private checkForErrors(child: ChildProcess, stderr: string) {
        if (this.state.currentProcess !== child) return;

        const currentSessionState = this.state;

        // Detect Gemini's "Invalid session identifier"
        if (stderr.includes('Invalid session identifier') || stderr.includes('No previous sessions found')) {
            if (currentSessionState.geminiSessionId) {
                console.warn(`[OneShotSession ${this.sessionId}] Gemini session ${currentSessionState.geminiSessionId} is invalid.`);
            }
            this.stateManager.markInvalidGeminiSession();
            this.stateManager.stopProcessing();

            this.emitLog('\n[Session Error] Previous session was invalid. Restarting fresh...\n', 'system');

            // Auto-retry with the last message
            const lastMessage = this.state.lastUserMessage;
            if (lastMessage) {
                void this.processMessage(lastMessage);
            }
        }

        // Detect Gemini API connection errors
        if (stderr.includes('Error when talking to Gemini API')) {
            const quotaMatch = stderr.match(/Your quota will reset after (\d+h\d+m\d+s|\d+m\d+s|\d+s)/);
            if (stderr.includes('exhausted your capacity') || quotaMatch) {
                const resetTime = quotaMatch ? quotaMatch[1] : 'some time';
                this.emitLog(`\n[Gemini Quota Error] API quota exhausted. Quota will reset after ${resetTime}.\n`, 'error');
            } else {
                if (currentSessionState.geminiSessionId) {
                    console.warn(`[OneShotSession ${this.sessionId}] Gemini API error, clearing session ID.`);
                }
                this.stateManager.markInvalidGeminiSession();
                this.emitLog('\n[Gemini API Error] Connection to Gemini API failed.\n', 'error');
            }
        }
    }

    private parseStreamJson(chunk: string) {
        const lines = chunk.split('\n').filter(l => l.trim().length > 0);
        const type = this.state.config.type;

        for (const line of lines) {
            try {
                const json = JSON.parse(line);
                const logs = this.parser.processJsonEvent(json, type);

                for (const log of logs) {
                    if (log.metadata?.geminiSessionId) {
                        this.stateManager.setGeminiSessionId(log.metadata.geminiSessionId);
                    }
                    if (log.metadata?.codexThreadId) {
                        this.stateManager.setCodexThreadId(log.metadata.codexThreadId);
                    }
                    this.emitLog(log.data, log.type, log.raw);
                }
            } catch {
                // Not valid JSON, ignore
            }
        }
    }

    private handlePendingWorktreeResume() {
        const pending = this.state.pendingWorktreeResume;
        if (!pending) return;

        this.stateManager.clearWorktreeResume();
        this.stateManager.activateWorktree({
            cwd: pending.request.cwd,
            branch: pending.request.branch,
            repoPath: pending.request.repoPath,
        });

        this.emitLog(`\n[System] Switching to worktree ${pending.request.branch} at ${pending.request.cwd}\n`, 'system');
        void this.processMessage(pending.resumeMessage);
    }

    private async resolveSessionCwd(): Promise<string | undefined> {
        const state = this.state;
        const requestedCwd = state.config.cwd;

        if (requestedCwd && await this.pathExists(requestedCwd)) {
            return requestedCwd;
        }

        const fallbackCwd = state.projectRoot;
        if (fallbackCwd && await this.pathExists(fallbackCwd)) {
            if (requestedCwd) {
                this.stateManager.updateConfig({ cwd: fallbackCwd });
                if (state.activeWorktree) {
                    this.stateManager.clearActiveWorktree();
                }
                this.emitLog(`\n[System] Worktree path not found. Falling back to ${fallbackCwd}\n`, 'system');
            }
            return fallbackCwd;
        }

        if (requestedCwd) {
            this.emitLog(`\n[System] Working directory not found: ${requestedCwd}. Using default cwd.\n`, 'system');
        }

        return undefined;
    }

    private async validateActiveWorktree(): Promise<void> {
        const state = this.state;
        if (!state.activeWorktree) return;
        const cwd = state.config.cwd;
        if (cwd && await this.pathExists(cwd)) return;

        this.stateManager.clearActiveWorktree();

        const fallback = state.projectRoot;
        if (fallback) {
            this.stateManager.updateConfig({ cwd: fallback });
        }
        this.emitLog(`\n[System] Worktree path missing. Worktree context cleared.\n`, 'system');
    }

    private async pathExists(targetPath: string): Promise<boolean> {
        try {
            const stats = await fs.stat(targetPath);
            return stats.isDirectory();
        } catch {
            return false;
        }
    }

    private buildWorktreeResumeMessage(request: WorktreeResumeRequest): string {
        const projectRoot = this.state.projectRoot ?? request.repoPath;
        const originalMessage = this.state.lastUserMessage ?? '';
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

    private buildWorktreeInstructions(): string {
        const session = this.state;
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

    private appendWorktreeReminder(message: string): string {
        const session = this.state;
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

    private emitLog(
        data: string,
        type: AgentLogPayload['type'] = 'text',
        raw?: unknown
    ) {
        const payload: AgentLogPayload = {
            sessionId: this.sessionId,
            data,
            type,
            raw,
        };
        this.emit('log', payload);
    }
}
