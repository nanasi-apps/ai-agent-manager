import type { AgentType } from "./agent";

export type OrchestrationTaskStatus = "queued" | "sent" | "failed";

export interface OrchestrationTask {
    id: string;
    sessionId: string;
    message: string;
    status: OrchestrationTaskStatus;
    createdAt: number;
    updatedAt: number;
    error?: string;
}

export interface DispatchTaskInput {
    sessionId: string;
    message: string;
    command?: string;
    agentType?: AgentType;
    agentModel?: string;
    streamJson?: boolean;
    cwd?: string;
    env?: Record<string, string>;
}

export interface BroadcastContextInput {
    message: string;
    sessionIds?: string[];
}

export interface BroadcastContextResult {
    sent: string[];
    failed: Array<{ sessionId: string; error: string }>;
}

export interface AgentStatus {
    sessionId: string;
    isRunning: boolean;
    lastSeenAt?: number;
}

export interface IOrchestrationManager {
    dispatchTask(input: DispatchTaskInput): Promise<OrchestrationTask>;
    listTasks(): OrchestrationTask[];
    getAgentStatuses(): AgentStatus[];
    broadcastContext(input: BroadcastContextInput): Promise<BroadcastContextResult>;
}
