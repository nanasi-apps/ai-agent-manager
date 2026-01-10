import { os } from "@orpc/server";
import { z } from "zod";
import { getRouterContext } from "./createRouter";

export const devServerRouter = {
	devServerLaunch: os
		.input(
			z.object({
				projectId: z.string(),
				conversationId: z.string().optional(),
				timeout: z.number().default(60000),
				configName: z.string().optional(),
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
			const ctx = getRouterContext();
			// Try to get worktree path from active session
			let worktreeCwd: string | undefined;
			console.log(
				`[devServerLaunch] Called with projectId=${input.projectId}, conversationId=${input.conversationId ?? "undefined"}`,
			);

			if (input.conversationId) {
				try {
					// Check active session first
					worktreeCwd = ctx.agentManager.getSessionCwd?.(input.conversationId);

					if (worktreeCwd) {
						console.log(
							`[devServerLaunch] Using worktree from active session: ${worktreeCwd}`,
						);
					} else {
						// Fallback: try to get worktree cwd from persisted agentState in store
						try {
							const conversation = ctx.store.getConversation(
								input.conversationId,
							);

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
									console.log(
										`[devServerLaunch] Using worktree from persisted agentState: ${persistedCwd}`,
									);
									worktreeCwd = persistedCwd;
								} else {
									console.log(
										`[devServerLaunch] No worktree cwd found in persisted state`,
									);
								}
							} else {
								console.log(
									`[devServerLaunch] No agentState found for conversation ${input.conversationId}`,
								);
							}
						} catch (e) {
							console.log(
								`[devServerLaunch] Error getting worktree from store: ${e}`,
							);
						}
					}
				} catch (e) {
					console.log(`[devServerLaunch] Error in devServerLaunch logic: ${e}`);
				}
			}

			const process = await ctx.devServerService.launchProject(
				input.projectId,
				{
					timeout: input.timeout,
					cwd: worktreeCwd,
					conversationId: input.conversationId,
					configName: input.configName,
				},
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
		.input(
			z.object({
				projectId: z.string(),
				conversationId: z.string().optional(),
			}),
		)
		.output(z.boolean())
		.handler(async ({ input }) => {
			const ctx = getRouterContext();
			return ctx.devServerService.stopProject(
				input.projectId,
				input.conversationId,
			);
		}),

	devServerStatus: os
		.input(
			z.object({
				projectId: z.string(),
				conversationId: z.string().optional(),
			}),
		)
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
					status: z.enum(["running", "stopped", "error"]),
				})
				.optional(),
		)
		.handler(async ({ input }) => {
			const ctx = getRouterContext();
			const process = ctx.devServerService.getRunningProject(
				input.projectId,
				input.conversationId,
			);
			// getRunningProject now returns undefined if status is NOT running
			// But if we want to return 'stopped' or 'error' status, we should probably change getRunningProject
			// OR use a different method to get "any" project status.
			// For now, if undefined, frontend assumes stopped.

			if (!process) return undefined;

			return {
				pid: process.pid,
				projectId: process.projectId,
				url: process.url,
				type: process.type,
				command: process.command,
				startedAt: process.startedAt,
				conversationId: process.conversationId,
				status: process.status,
			};
		}),

	devServerLogs: os
		.input(
			z.object({
				projectId: z.string(),
				conversationId: z.string().optional(),
			}),
		)
		.output(z.array(z.string()))
		.handler(async ({ input }) => {
			const ctx = getRouterContext();
			return ctx.devServerService.getProjectLogs(
				input.projectId,
				input.conversationId,
			);
		}),
};
