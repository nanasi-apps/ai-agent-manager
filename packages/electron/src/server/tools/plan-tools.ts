import { randomUUID } from "node:crypto";
import { type ApprovalChannel, getStoreOrThrow } from "@agent-manager/shared";
import { z } from "zod";
import { getSessionContext } from "../mcp-session-context";
import type { ToolRegistrar } from "./types";

function generateFallbackUUID(): string {
	return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
		const r = (Math.random() * 16) | 0;
		const v = c === "x" ? r : (r & 0x3) | 0x8;
		return v.toString(16);
	});
}

function generateId(): string {
	try {
		return randomUUID();
	} catch {
		return generateFallbackUUID();
	}
}

function generatePlanSummary(planContent: string): string {
	const clean = planContent.replace(/^#+\s*/gm, "").replace(/\n+/g, " ").trim();
	if (clean.length <= 200) return clean;
	return `${clean.slice(0, 200)}...`;
}

export function registerPlanTools(registerTool: ToolRegistrar) {
	registerTool(
		"propose_implementation_plan",
		{
			description:
				"Propose an implementation plan to the user. Use this when you have created a plan that needs user review before execution.",
			inputSchema: {
				planContent: z
					.string()
					.describe("The Markdown content of the implementation plan"),
				sessionId: z
					.string()
					.optional()
					.describe("Optional session ID when not using a session MCP URL"),
			},
		},
		async ({ planContent, sessionId: sessionIdArg }) => {
			if (!planContent || !planContent.trim()) {
				return {
					content: [
						{
							type: "text",
							text: "Error: planContent is required.",
						},
					],
					isError: true,
				};
			}

			const context = getSessionContext();
			const sessionId = context?.sessionId || sessionIdArg;

			if (!sessionId) {
				return {
					content: [
						{
							type: "text",
							text: "Error: sessionId is required.",
						},
					],
					isError: true,
				};
			}

			const store = getStoreOrThrow();

			store.addMessage(sessionId, {
				id: generateId(),
				role: "agent",
				content: planContent,
				timestamp: Date.now(),
				logType: "plan" as any,
			});

			return {
				content: [
					{
						type: "text",
						text: "Plan proposed successfully. It is now visible to the user for review.",
					},
				],
			};
		},
	);

	registerTool(
		"planning_create",
		{
			description:
				"Create a plan approval request for the current session (Inbox by default).",
			inputSchema: {
				planContent: z
					.string()
					.describe("The plan content to submit for approval"),
				planSummary: z
					.string()
					.optional()
					.describe("Optional summary shown in the approval list"),
				sessionId: z
					.string()
					.optional()
					.describe("Optional session ID when not using a session MCP URL"),
			},
		},
		async ({ planContent, planSummary, sessionId: sessionIdArg }) => {
			if (!planContent || !planContent.trim()) {
				return {
					content: [
						{
							type: "text",
							text: "Error: planContent is required to create an approval request.",
						},
					],
					isError: true,
				};
			}

			const context = getSessionContext();
			const sessionId = context?.sessionId || sessionIdArg;

			if (!sessionId) {
				return {
					content: [
						{
							type: "text",
							text: "Error: sessionId is required when no session context is available.",
						},
					],
					isError: true,
				};
			}

			const store = getStoreOrThrow();
			const conversation = store.getConversation(sessionId);

			if (!conversation) {
				return {
					content: [
						{
							type: "text",
							text: `Error: conversation not found for session ${sessionId}.`,
						},
					],
					isError: true,
				};
			}

			const now = Date.now();
			const approvalId = generateId();
			const summary = planSummary?.trim() || generatePlanSummary(planContent);
			const notificationChannels = Array.from(
				new Set<ApprovalChannel>([
					"inbox",
					...(store.getAppSettings().approvalNotificationChannels || []),
				]),
			);

			store.addApproval({
				id: approvalId,
				sessionId,
				projectId: conversation.projectId || "",
				planContent,
				planSummary: summary,
				status: "pending",
				channel: "inbox",
				notificationChannels,
				createdAt: now,
				updatedAt: now,
			});

			store.addMessage(sessionId, {
				id: generateId(),
				role: "system",
				content: "Plan sent to Inbox for approval.",
				timestamp: now,
				logType: "system",
			});

			return {
				content: [
					{
						type: "text",
						text: JSON.stringify(
							{ id: approvalId, success: true, channel: "inbox" },
							null,
							2,
						),
					},
				],
			};
		},
	);
}
