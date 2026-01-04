import { os } from "@orpc/server";
import { z } from "zod";
import {
    getAgentManagerOrThrow,
    getStoreOrThrow,
} from "../services/dependency-container";
import { parseModelId } from "../services/model-fetcher";
import {
    buildSessionConfig,
    startAgentSession,
} from "../services/session-builder";
import type { ApprovalChannel, ApprovalRequest } from "../types/approval";
import { generateUUID } from "../utils";

const approvalChannels = ["inbox", "slack", "discord"] as const;
const approvalStatusSchema = z.enum([
    "pending",
    "approved",
    "rejected",
    "expired",
]);
const approvalChannelSchema = z.enum(approvalChannels);

/**
 * Generate a summary from plan content
 * Takes first 200 chars of the plan as summary
 */
function generatePlanSummary(planContent: string): string {
    const clean = planContent
        .replace(/^#+\s*/gm, "") // Remove markdown headers
        .replace(/\n+/g, " ")
        .trim();
    if (clean.length <= 200) return clean;
    return clean.slice(0, 200) + "...";
}

function resolveNotificationChannels(
    configuredChannels: ApprovalChannel[] | undefined,
): ApprovalChannel[] {
    const unique = new Set<ApprovalChannel>(["inbox"]);
    for (const channel of configuredChannels ?? []) {
        if (approvalChannels.includes(channel)) {
            unique.add(channel);
        }
    }
    return Array.from(unique);
}

export const approvalsRouter = {
    /**
     * Create a new approval request
     */
    createApproval: os
        .input(
            z.object({
                sessionId: z.string(),
                projectId: z.string(),
                planContent: z.string(),
                planSummary: z.string().optional(),
            }),
        )
        .output(
            z.object({
                id: z.string(),
                success: z.boolean(),
            }),
        )
        .handler(async ({ input }) => {
            const storeInstance = getStoreOrThrow();
            const now = Date.now();
            const notificationChannels = resolveNotificationChannels(
                storeInstance.getAppSettings().approvalNotificationChannels,
            );

            const approval: ApprovalRequest = {
                id: generateUUID(),
                sessionId: input.sessionId,
                projectId: input.projectId,
                planContent: input.planContent,
                planSummary: input.planSummary || generatePlanSummary(input.planContent),
                status: "pending",
                channel: "inbox",
                notificationChannels,
                createdAt: now,
                updatedAt: now,
            };

            storeInstance.addApproval(approval);

            return { id: approval.id, success: true };
        }),

    /**
     * Get a single approval request by ID
     */
    getApproval: os
        .input(z.object({ id: z.string() }))
        .output(
            z
                .object({
                    id: z.string(),
                    sessionId: z.string(),
                    projectId: z.string(),
                    planContent: z.string(),
                    planSummary: z.string(),
                    status: approvalStatusSchema,
                    channel: approvalChannelSchema,
                    notificationChannels: z
                        .array(approvalChannelSchema)
                        .optional(),
                    createdAt: z.number(),
                    updatedAt: z.number(),
                    approvedModelId: z.string().optional(),
                    mode: z.enum(["regular", "plan", "ask"]).optional(),
                    respondedBy: z.string().optional(),
                    respondedAt: z.number().optional(),
                    responseMessage: z.string().optional(),
                })
                .nullable(),
        )
        .handler(async ({ input }) => {
            const approval = getStoreOrThrow().getApproval(input.id);
            return approval || null;
        }),

    /**
     * List approval requests, optionally filtered by status
     */
    listApprovals: os
        .input(
            z.object({
                status: approvalStatusSchema.optional(),
            }),
        )
        .output(
            z.array(
                z.object({
                    id: z.string(),
                    sessionId: z.string(),
                    projectId: z.string(),
                    planSummary: z.string(),
                    status: approvalStatusSchema,
                    channel: approvalChannelSchema,
                    notificationChannels: z
                        .array(approvalChannelSchema)
                        .optional(),
                    createdAt: z.number(),
                    updatedAt: z.number(),
                }),
            ),
        )
        .handler(async ({ input }) => {
            const approvals = getStoreOrThrow().listApprovals(input.status);
            // Return without planContent for list view to reduce payload
            return approvals.map((a) => ({
                id: a.id,
                sessionId: a.sessionId,
                projectId: a.projectId,
                planSummary: a.planSummary,
                status: a.status,
                channel: a.channel,
                notificationChannels: a.notificationChannels,
                createdAt: a.createdAt,
                updatedAt: a.updatedAt,
            }));
        }),

    /**
     * Get count of pending approvals (for inbox badge)
     */
    getPendingCount: os
        .input(z.object({}))
        .output(z.object({ count: z.number() }))
        .handler(async () => {
            const pending = getStoreOrThrow().listApprovals("pending");
            return { count: pending.length };
        }),

    /**
     * Approve a plan and execute it with selected model
     */
    approveAndExecute: os
        .input(
            z.object({
                id: z.string(),
                modelId: z.string(),
                message: z.string().optional(),
            }),
        )
        .output(
            z.object({
                success: z.boolean(),
                sessionId: z.string().optional(),
                message: z.string().optional(),
            }),
        )
        .handler(async ({ input }) => {
            const storeInstance = getStoreOrThrow();
            const agentManagerInstance = getAgentManagerOrThrow();

            const approval = storeInstance.getApproval(input.id);
            if (!approval) {
                return { success: false, message: "Approval request not found" };
            }

            if (approval.status !== "pending") {
                return {
                    success: false,
                    message: `Approval already ${approval.status}`,
                };
            }

            // Parse the model ID
            const parsedModel = parseModelId(input.modelId);
            if (!parsedModel) {
                return { success: false, message: "Invalid model ID" };
            }

            // Delete approval request as it is now approved and being executed
            storeInstance.deleteApproval(input.id);

            // Get the conversation
            const conv = storeInstance.getConversation(approval.sessionId);
            if (!conv) {
                return { success: false, message: "Conversation not found" };
            }

            // Build the execution prompt
            const executionPrompt = `The following plan has been approved for execution. Please execute it now:

${approval.planContent}

The plan above was approved for execution. Please proceed now.
${input.message ? `Additional instructions: ${input.message}` : "Execute the plan as specified."}`;

            // Build session config
            const sessionConfig = await buildSessionConfig({
                projectId: conv.projectId,
                agentType: parsedModel.agentType,
                model: parsedModel.model,
                mode: "regular", // Always execute in agent mode
                cwd: conv.cwd,
            });

            // Update conversation with new agent settings
            storeInstance.updateConversation(approval.sessionId, {
                agentType: parsedModel.agentType,
                agentModel: parsedModel.model,
                agentMode: "regular",
            });

            // Add system message about approval
            storeInstance.addMessage(approval.sessionId, {
                id: generateUUID(),
                role: "system",
                content: `Plan approved and execution started with ${parsedModel.agentType}${parsedModel.model ? ` - ${parsedModel.model}` : ""}.`,
                timestamp: Date.now(),
                logType: "system",
            });

            // Stop any existing session and start fresh
            // This ensures that old session IDs (e.g., geminiSessionId) are cleared,
            // preventing the CLI from attempting to --resume an invalid session.
            if (agentManagerInstance.isRunning(approval.sessionId)) {
                agentManagerInstance.stopSession(approval.sessionId);
            }
            startAgentSession(
                agentManagerInstance,
                approval.sessionId,
                sessionConfig,
            );

            // Send the execution prompt
            agentManagerInstance.sendToSession(approval.sessionId, executionPrompt);

            return {
                success: true,
                sessionId: approval.sessionId,
                message: "Plan execution started",
            };
        }),

    /**
     * Reject an approval request
     */
    rejectApproval: os
        .input(
            z.object({
                id: z.string(),
                message: z.string().optional(),
            }),
        )
        .output(z.object({ success: z.boolean() }))
        .handler(async ({ input }) => {
            const storeInstance = getStoreOrThrow();

            const approval = storeInstance.getApproval(input.id);
            if (!approval) {
                return { success: false };
            }

            if (approval.status !== "pending") {
                return { success: false };
            }

            storeInstance.updateApproval(input.id, {
                status: "rejected",
                respondedAt: Date.now(),
                responseMessage: input.message,
            });

            // Add a message to the conversation
            storeInstance.addMessage(approval.sessionId, {
                id: generateUUID(),
                role: "system",
                content: `Plan was rejected.${input.message ? ` Reason: ${input.message}` : ""}`,
                timestamp: Date.now(),
                logType: "system",
            });

            return { success: true };
        }),

    /**
     * Delete an approval request
     */
    deleteApproval: os
        .input(z.object({ id: z.string() }))
        .output(z.object({ success: z.boolean() }))
        .handler(async ({ input }) => {
            getStoreOrThrow().deleteApproval(input.id);
            return { success: true };
        }),
};
