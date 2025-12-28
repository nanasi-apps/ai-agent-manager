import type {
    AgentStatus,
    BroadcastContextInput,
    BroadcastContextResult,
    DispatchTaskInput,
    OrchestrationTask
} from "@agent-manager/shared";
import { getAgentTemplate } from "@agent-manager/shared";
import { getAgentManager } from "../agents/agent-manager";

function generateUUID(): string {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
        return crypto.randomUUID();
    }
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
        const r = Math.random() * 16 | 0;
        const v = c === "x" ? r : (r & 0x3) | 0x8;
        return v.toString(16);
    });
}

export class OrchestrationManager {
    private tasks: OrchestrationTask[] = [];
    private lastSeen: Map<string, number> = new Map();
    private initialized = false;

    initialize() {
        if (this.initialized) return;
        try {
            const manager = getAgentManager();
            manager.on("log", (payload) => {
                this.lastSeen.set(payload.sessionId, Date.now());
            });
            this.initialized = true;
        } catch (error) {
            console.warn("[OrchestrationManager] Unable to attach log listener yet.", error);
        }
    }

    listTasks(): OrchestrationTask[] {
        return [...this.tasks].sort((a, b) => b.updatedAt - a.updatedAt);
    }

    getAgentStatuses(): AgentStatus[] {
        const manager = getAgentManager();
        return manager.listSessions().map((sessionId) => ({
            sessionId,
            isRunning: manager.isRunning(sessionId),
            lastSeenAt: this.lastSeen.get(sessionId)
        }));
    }

    async dispatchTask(input: DispatchTaskInput): Promise<OrchestrationTask> {
        const now = Date.now();
        const task: OrchestrationTask = {
            id: generateUUID(),
            sessionId: input.sessionId,
            message: input.message,
            status: "queued",
            createdAt: now,
            updatedAt: now
        };
        this.tasks.push(task);

        try {
            const manager = getAgentManager();
            if (!manager.isRunning(input.sessionId)) {
                const command = input.command
                    ?? (input.agentType ? getAgentTemplate(input.agentType)?.agent.command : undefined);
                if (!command) {
                    throw new Error("command or agentType is required to start a new session.");
                }
                manager.startSession(input.sessionId, command, {
                    type: input.agentType ?? "custom",
                    command,
                    model: input.agentModel,
                    streamJson: input.streamJson,
                    cwd: input.cwd,
                    env: input.env
                });
            }

            await manager.sendToSession(input.sessionId, input.message);
            task.status = "sent";
            task.updatedAt = Date.now();
        } catch (error) {
            task.status = "failed";
            task.updatedAt = Date.now();
            task.error = error instanceof Error ? error.message : String(error);
        }

        return task;
    }

    async broadcastContext(input: BroadcastContextInput): Promise<BroadcastContextResult> {
        const manager = getAgentManager();
        const targets = input.sessionIds && input.sessionIds.length > 0
            ? input.sessionIds
            : manager.listSessions();

        const sent: string[] = [];
        const failed: Array<{ sessionId: string; error: string }> = [];

        for (const sessionId of targets) {
            try {
                if (!manager.isRunning(sessionId)) {
                    throw new Error("session not running");
                }
                await manager.sendToSession(sessionId, input.message);
                sent.push(sessionId);
            } catch (error) {
                failed.push({
                    sessionId,
                    error: error instanceof Error ? error.message : String(error)
                });
            }
        }

        return { sent, failed };
    }
}

export const orchestrationManager = new OrchestrationManager();
