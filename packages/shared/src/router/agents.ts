import { os } from "@orpc/server";
import { z } from "zod";
import {
	getAgentManagerOrThrow,
	getNativeDialog,
	getStoreOrThrow,
	getWorktreeManagerOrThrow,
} from "../services/dependency-container";
import type { AgentType } from "../types/agent";

const agentTypeSchema = z.string();

export const agentsRouter = {
	startAgent: os
		.input(
			z.object({
				command: z.string(),
				sessionId: z.string().default("debug-session"),
				agentType: agentTypeSchema.optional(),
				agentModel: z.string().optional(),
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
			try {
				getAgentManagerOrThrow().startSession(input.sessionId, input.command, {
					type: (input.agentType as AgentType) || "custom",
					command: input.command,
					model: input.agentModel,
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
			getAgentManagerOrThrow().stopSession(input.sessionId);
			return { success: true, message: "Agent stopped" };
		}),

	isAgentRunning: os
		.input(z.object({ sessionId: z.string() }))
		.output(z.boolean())
		.handler(async ({ input }) => {
			const manager = getAgentManagerOrThrow();
			if (manager.isProcessing) {
				return manager.isProcessing(input.sessionId);
			}
			return manager.isRunning(input.sessionId);
		}),

	listActiveSessions: os.output(z.array(z.string())).handler(async () => {
		return getAgentManagerOrThrow().listSessions();
	}),

	selectDirectory: os.output(z.string().nullable()).handler(async () => {
		const dialog = getNativeDialog();
		if (!dialog) return null;
		return dialog.selectDirectory();
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
			let targetPath: string | null = null;

			// Priority 1: If sessionId is provided, try to get the session's cwd from agent manager (live session)
			if (input.sessionId) {
				const sessionCwd = getAgentManagerOrThrow().getSessionCwd?.(
					input.sessionId,
				);
				if (sessionCwd) {
					targetPath = sessionCwd;
				}
			}

			// Priority 2: If no live session cwd, try to get from persisted conversation
			if (!targetPath && input.sessionId) {
				const conv = getStoreOrThrow().getConversation(input.sessionId);
				if (conv?.cwd) {
					targetPath = conv.cwd;
				}
			}

			// Priority 3: Fallback to project's rootPath
			if (!targetPath && input.projectId) {
				const project = getStoreOrThrow().getProject(input.projectId);
				if (project?.rootPath) {
					targetPath = project.rootPath;
				}
			}

			if (!targetPath) return null;

			try {
				const status =
					await getWorktreeManagerOrThrow().getWorktreeStatus(targetPath);
				return status.branch;
			} catch (e) {
				console.error("[AgentsRouter] Failed to get current branch:", e);
				return null;
			}
		}),
};
