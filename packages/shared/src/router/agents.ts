import { os } from "@orpc/server";
import { z } from "zod";
import type { AgentType } from "../types/agent";
import { getRouterContext } from "./createRouter";

const agentTypeSchema = z.string();
const reasoningLevelSchema = z.enum(["low", "middle", "high", "extraHigh"]);

export const agentsRouter = {
	startAgent: os
		.input(
			z.object({
				command: z.string(),
				sessionId: z.string().default("debug-session"),
				agentType: agentTypeSchema.optional(),
				agentModel: z.string().optional(),
				agentReasoning: reasoningLevelSchema.optional(),
				streamJson: z.boolean().optional(),
				cwd: z.string().optional(),
			}),
		)
		.output(
			z.object({
				success: z.boolean(),
				message: z.string(),
			}),
		)
		.handler(async ({ input }) => {
			const ctx = getRouterContext();
			try {
				ctx.agentManager.startSession(input.sessionId, input.command, {
					type: (input.agentType as AgentType) || "custom",
					command: input.command,
					model: input.agentModel,
					reasoning: input.agentReasoning,
					streamJson: input.streamJson,
					cwd: input.cwd,
				});
				return { success: true, message: "Agent started" };
			} catch (e) {
				const err = e as Error;
				return { success: false, message: err.message };
			}
		}),

	stopAgent: os
		.input(
			z.object({
				sessionId: z.string().default("debug-session"),
			}),
		)
		.output(
			z.object({
				success: z.boolean(),
				message: z.string(),
			}),
		)
		.handler(async ({ input }) => {
			const ctx = getRouterContext();
			ctx.agentManager.stopSession(input.sessionId);
			return { success: true, message: "Agent stopped" };
		}),

	isAgentRunning: os
		.input(z.object({ sessionId: z.string() }))
		.output(z.boolean())
		.handler(async ({ input }) => {
			const ctx = getRouterContext();
			if (ctx.agentManager.isProcessing) {
				return ctx.agentManager.isProcessing(input.sessionId);
			}
			return ctx.agentManager.isRunning(input.sessionId);
		}),

	listActiveSessions: os.output(z.array(z.string())).handler(async () => {
		const ctx = getRouterContext();
		return ctx.agentManager.listSessions();
	}),

	selectDirectory: os.output(z.string().nullable()).handler(async () => {
		const ctx = getRouterContext();
		const dialog = ctx.nativeDialog;
		if (!dialog) return null;
		return dialog.selectDirectory();
	}),
	selectPaths: os
		.input(
			z.object({
				type: z.enum(["file", "dir", "any"]),
				multiple: z.boolean().optional(),
			}),
		)
		.output(z.array(z.string()))
		.handler(async ({ input }) => {
			const ctx = getRouterContext();
			const dialog = ctx.nativeDialog;
			if (!dialog) return [];
			return dialog.selectPaths({
				type: input.type,
				multiple: input.multiple,
			});
		}),

	getCurrentBranch: os
		.input(
			z.object({
				projectId: z.string().optional(),
				sessionId: z.string().optional(),
			}),
		)
		.output(z.string().nullable())
		.handler(async ({ input }) => {
			const ctx = getRouterContext();
			let targetPath: string | null = null;

			// Priority 1: If sessionId is provided, try to get the session's cwd from agent manager (live session)
			if (input.sessionId) {
				const sessionCwd = ctx.agentManager.getSessionCwd?.(input.sessionId);
				if (sessionCwd) {
					targetPath = sessionCwd;
				}
			}

			// Priority 2: If no live session cwd, try to get from persisted conversation
			if (!targetPath && input.sessionId) {
				const conv = ctx.store.getConversation(input.sessionId);
				if (conv?.cwd) {
					targetPath = conv.cwd;
				}
			}

			// Priority 3: Fallback to project's rootPath
			if (!targetPath && input.projectId) {
				const project = ctx.store.getProject(input.projectId);
				if (project?.rootPath) {
					targetPath = project.rootPath;
				}
			}

			if (!targetPath) return null;

			try {
				const status = await ctx.worktreeManager.getWorktreeStatus(targetPath);
				return status.branch;
			} catch (e) {
				console.error("[AgentsRouter] Failed to get current branch:", e);
				return null;
			}
		}),
};
