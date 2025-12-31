import { randomUUID } from "node:crypto";
import { getStoreOrThrow } from "@agent-manager/shared";
import { z } from "zod";
import { getSessionContext } from "../mcp-session-context";
import type { ToolRegistrar } from "./types";

const approvalChannelSchema = z.enum(["inbox", "slack", "discord"]);

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
				channel: approvalChannelSchema
					.optional()
					.describe("Notification channel for the approval request"),
				sessionId: z
					.string()
					.optional()
					.describe("Optional session ID when not using a session MCP URL"),
			},
		},
		async ({ planContent, planSummary, channel, sessionId: sessionIdArg }) => {
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

			store.addApproval({
				id: approvalId,
				sessionId,
				projectId: conversation.projectId || "",
				planContent,
				planSummary: summary,
				status: "pending",
				channel: channel || "inbox",
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
							{ id: approvalId, success: true, channel: channel || "inbox" },
							null,
							2,
						),
					},
				],
			};
		},
	);
}
