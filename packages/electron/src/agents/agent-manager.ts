import type { AgentConfig, AgentLogPayload } from '@agent-manager/shared';

/**
 * Interface for AgentManager implementations
 * Allows swapping between different implementations (PTY, OneShot, etc.)
 */
export interface IAgentManager {
    startSession(sessionId: string, command: string, config?: Partial<AgentConfig>): void;
    resetSession(sessionId: string, command: string, config?: Partial<AgentConfig>): void;
    stopSession(sessionId: string): boolean;
    sendToSession(sessionId: string, message: string): Promise<void>;
    isRunning(sessionId: string): boolean;
    listSessions(): string[];
    on(event: 'log', listener: (payload: AgentLogPayload) => void): void;
    getSessionMetadata?(sessionId: string): { geminiSessionId?: string; codexThreadId?: string } | undefined;
    setPendingHandover?(sessionId: string, context: string): void;
    consumePendingHandover?(sessionId: string): string | undefined;
}

// Current active agent manager instance
let activeAgentManager: IAgentManager | null = null;

/**
 * Set the active agent manager implementation
 */
export function setAgentManager(manager: IAgentManager): void {
    activeAgentManager = manager;
    console.log('[AgentManager] Implementation set');
}

/**
 * Get the current agent manager instance
 * Throws if no manager has been set
 */
export function getAgentManager(): IAgentManager {
    if (!activeAgentManager) {
        throw new Error('Agent manager not initialized. Call setAgentManager first.');
    }
    return activeAgentManager;
}

/**
 * Proxy object for convenient access to agent manager methods
 */
export const agentManager = {
    instance(): IAgentManager {
        return getAgentManager();
    },
    startSession(sessionId: string, command: string, config?: Partial<AgentConfig>) {
        return getAgentManager().startSession(sessionId, command, config);
    },
    resetSession(sessionId: string, command: string, config?: Partial<AgentConfig>) {
        return getAgentManager().resetSession(sessionId, command, config);
    },
    stopSession(sessionId: string) {
        return getAgentManager().stopSession(sessionId);
    },
    async sendToSession(sessionId: string, message: string) {
        return getAgentManager().sendToSession(sessionId, message);
    },
    isRunning(sessionId: string) {
        return getAgentManager().isRunning(sessionId);
    },
    listSessions() {
        return getAgentManager().listSessions();
    },
    on(event: 'log', listener: (payload: AgentLogPayload) => void) {
        return getAgentManager().on(event, listener);
    },
};