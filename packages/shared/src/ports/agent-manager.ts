/**
 * IAgentManager - Port interface for agent session management
 *
 * This interface defines the contract for managing agent sessions.
 * Implementations handle the actual process spawning, I/O, and lifecycle.
 */

import type {
    AgentConfig,
    AgentLogPayload,
    AgentStatePayload,
} from "../types/agent";

export interface IAgentManager {
    startSession(
        sessionId: string,
        command: string,
        config?: Partial<AgentConfig>,
    ): void;

    resetSession(
        sessionId: string,
        command: string,
        config?: Partial<AgentConfig>,
    ): void;

    stopSession(sessionId: string): boolean;

    sendToSession(sessionId: string, message: string): Promise<void>;

    isRunning(sessionId: string): boolean;

    isProcessing?(sessionId: string): boolean;

    listSessions(): string[];

    on(event: "log", listener: (payload: AgentLogPayload) => void): void;
    on(
        event: "state-changed",
        listener: (payload: AgentStatePayload) => void,
    ): void;

    getSessionMetadata(sessionId: string):
        | {
            geminiSessionId?: string;
            codexSessionId?: string;
            codexThreadId?: string;
        }
        | undefined;

    /** Store handover context to prepend to next user message */
    setPendingHandover(sessionId: string, context: string): void;

    /** Retrieve and clear pending handover context */
    consumePendingHandover(sessionId: string): string | undefined;

    /** Schedule a resume in a git worktree after the current turn completes. */
    requestWorktreeResume?(
        sessionId: string,
        request: {
            cwd: string;
            branch: string;
            repoPath: string;
            resumeMessage?: string;
        },
    ): boolean;

    /** Get the current working directory for a session */
    getSessionCwd?(sessionId: string): string | undefined;

    /** Get the temp home directories for a session (for MCP config inspection) */
    getSessionHomes?(
        sessionId: string,
    ): { geminiHome?: string; claudeHome?: string } | undefined;

    /** Get the current session config */
    getSessionConfig?(sessionId: string): Partial<AgentConfig> | undefined;
}
