import { os } from "@orpc/server";
import { z } from "zod";
import {
    getAgentManagerOrThrow,
    getDevServerServiceOrThrow,
    getStoreOrThrow,
} from "../services/dependency-container";

export const devServerRouter = {
    devServerLaunch: os
        .input(
            z.object({
                projectId: z.string(),
                conversationId: z.string().optional(),
                timeout: z.number().default(60000),
            }),
        )
        .output(
            z.object({
                pid: z.number(),
                projectId: z.string(),
                url: z.string().optional(),
                type: z.enum(["web", "process", "other"]),
                cwd: z.string().optional(),
                conversationId: z.string().optional(),
            }),
        )
        .handler(async ({ input }) => {
            // Try to get worktree path from active session
            let worktreeCwd: string | undefined;
            console.log(`[devServerLaunch] Called with projectId=${input.projectId}, conversationId=${input.conversationId ?? "undefined"}`);

            if (input.conversationId) {
                try {
                    const manager = getAgentManagerOrThrow();
                    // Check active session first
                    worktreeCwd = manager.getSessionCwd?.(input.conversationId);

                    if (worktreeCwd) {
                        console.log(`[devServerLaunch] Using worktree from active session: ${worktreeCwd}`);
                    } else {
                        // Fallback: try to get worktree cwd from persisted agentState in store
                        try {
                            // const { getStoreOrThrow } = await import("../services/dependency-container");
                            const store = getStoreOrThrow();
                            const conversation = store.getConversation(input.conversationId);

                            if (conversation?.agentState) {
                                // agentState is xstate snapshot
                                const agentState = conversation.agentState as {
                                    context?: {
                                        activeWorktree?: { cwd?: string };
                                        config?: { cwd?: string };
                                    };
                                };

                                const persistedCwd =
                                    agentState.context?.activeWorktree?.cwd ??
                                    agentState.context?.config?.cwd;

                                if (persistedCwd) {
                                    console.log(`[devServerLaunch] Using worktree from persisted agentState: ${persistedCwd}`);
                                    worktreeCwd = persistedCwd;
                                } else {
                                    console.log(`[devServerLaunch] No worktree cwd found in persisted state`);
                                }
                            } else {
                                console.log(`[devServerLaunch] No agentState found for conversation ${input.conversationId}`);
                            }
                        } catch (e) {
                            console.log(`[devServerLaunch] Error getting worktree from store: ${e}`);
                        }
                    }
                } catch (e) {
                    console.log(`[devServerLaunch] Error in devServerLaunch logic: ${e}`);
                }
            }

            const process = await getDevServerServiceOrThrow().launchProject(
                input.projectId,
                { timeout: input.timeout, cwd: worktreeCwd, conversationId: input.conversationId },
            );
            return {
                pid: process.pid,
                projectId: process.projectId,
                url: process.url,
                type: process.type,
                cwd: worktreeCwd,
                conversationId: process.conversationId,
            };
        }),

    devServerStop: os
        .input(z.object({ projectId: z.string(), conversationId: z.string().optional() }))
        .output(z.boolean())
        .handler(async ({ input }) => {
            return getDevServerServiceOrThrow().stopProject(input.projectId, input.conversationId);
        }),

    devServerStatus: os
        .input(z.object({ projectId: z.string(), conversationId: z.string().optional() }))
        .output(
            z
                .object({
                    pid: z.number(),
                    projectId: z.string(),
                    url: z.string().optional(),
                    type: z.enum(["web", "process", "other"]),
                    command: z.string(),
                    startedAt: z.number(),
                    conversationId: z.string().optional(),
                })
                .optional(),
        )
        .handler(async ({ input }) => {
            const process = getDevServerServiceOrThrow().getRunningProject(
                input.projectId,
                input.conversationId,
            );
            if (!process) return undefined;
            return {
                pid: process.pid,
                projectId: process.projectId,
                url: process.url,
                type: process.type,
                command: process.command,
                startedAt: process.startedAt,
                conversationId: process.conversationId,
            };
        }),
};
