
import type { AgentConfig } from '@agent-manager/shared';
import type { ChildProcess } from 'node:child_process';
import type { WorktreeResumeRequest } from './agent-manager';

export interface ActiveWorktreeContext {
    cwd: string;
    branch: string;
    repoPath: string;
}

export interface PendingWorktreeResume {
    request: WorktreeResumeRequest;
    resumeMessage: string;
}

export interface SessionState {
    config: AgentConfig;
    messageCount: number;
    buffer: string;
    isProcessing: boolean;
    currentProcess?: ChildProcess;
    sessionId: string;

    // Project context
    projectRoot?: string;
    activeWorktree?: ActiveWorktreeContext;
    pendingWorktreeResume?: PendingWorktreeResume;

    // Agent Specific
    geminiSessionId?: string;
    codexThreadId?: string;
    geminiHome?: string;
    claudeHome?: string;

    // Flags
    invalidGeminiSession?: boolean;
    pendingHandover?: string;
    lastUserMessage?: string;
}

export class SessionStateManager {
    private state: SessionState;

    constructor(sessionId: string, initialConfig: AgentConfig) {
        this.state = {
            sessionId,
            config: initialConfig,
            messageCount: 0,
            buffer: '',
            isProcessing: false,
            projectRoot: initialConfig.cwd,
        };
    }

    get(): SessionState {
        return this.state;
    }

    updateConfig(newConfig: Partial<AgentConfig>) {
        this.state.config = {
            ...this.state.config,
            ...newConfig,
        };
    }

    startProcessing(process: ChildProcess, message: string) {
        this.state.isProcessing = true;
        this.state.currentProcess = process;
        this.state.lastUserMessage = message;
        // Don't increment message count here, do it on successful start or wherever appropriate
    }

    stopProcessing() {
        if (this.state.currentProcess) {
            this.state.currentProcess.kill();
            this.state.currentProcess = undefined;
        }
        this.state.isProcessing = false;
    }

    incrementMessageCount() {
        this.state.messageCount++;
    }

    resetMessageCount() {
        this.state.messageCount = 0;
    }

    setGeminiSessionId(id: string) {
        if (!this.state.invalidGeminiSession) {
            this.state.geminiSessionId = id;
        }
    }

    clearGeminiSessionId() {
        this.state.geminiSessionId = undefined;
    }

    setCodexThreadId(id: string) {
        this.state.codexThreadId = id;
    }

    markInvalidGeminiSession() {
        this.state.invalidGeminiSession = true;
        this.state.geminiSessionId = undefined;
        this.state.messageCount = 0;
    }

    resetInvalidGeminiSession() {
        this.state.invalidGeminiSession = false;
    }

    setWorktreeResume(pending: PendingWorktreeResume) {
        this.state.pendingWorktreeResume = pending;
    }

    clearWorktreeResume() {
        this.state.pendingWorktreeResume = undefined;
    }

    activateWorktree(context: ActiveWorktreeContext) {
        this.state.activeWorktree = context;
        this.state.config.cwd = context.cwd;
    }

    clearActiveWorktree() {
        this.state.activeWorktree = undefined;
        // Fallback to project root if available
        if (this.state.projectRoot) {
            this.state.config.cwd = this.state.projectRoot;
        }
    }

    setGeminiHome(home: string) {
        this.state.geminiHome = home;
    }

    setClaudeHome(home: string) {
        this.state.claudeHome = home;
    }

    setPendingHandover(context: string) {
        this.state.pendingHandover = context;
    }

    consumePendingHandover(): string | undefined {
        const context = this.state.pendingHandover;
        this.state.pendingHandover = undefined;
        return context;
    }

    resetStateForNewType(config: AgentConfig) {
        const previousProjectRoot = this.state.projectRoot ?? this.state.config.cwd;

        // Reset process
        if (this.state.currentProcess) {
            this.state.currentProcess.kill();
        }

        this.state = {
            sessionId: this.state.sessionId,
            config: config,
            messageCount: 0,
            buffer: '',
            isProcessing: false,
            projectRoot: previousProjectRoot ?? config.cwd,
            // Clear agent specific stuff
            geminiSessionId: undefined,
            codexThreadId: undefined,
            geminiHome: undefined,
            claudeHome: undefined,
            lastUserMessage: undefined,
        };
    }

    // Non-destructive reset (same agent type)
    resetStateSoft(config: Partial<AgentConfig>) {
        if (this.state.currentProcess) {
            this.state.currentProcess.kill();
            this.state.currentProcess = undefined;
        }

        this.state.isProcessing = false;
        this.state.buffer = '';
        this.state.config = { ...this.state.config, ...config };
        this.state.projectRoot = this.state.projectRoot ?? this.state.config.cwd;
        this.state.pendingWorktreeResume = undefined;
    }
}
