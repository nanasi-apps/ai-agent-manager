import type { AgentMode } from "./agent";

/**
 * Status of an approval request
 */
export type ApprovalStatus = "pending" | "approved" | "rejected" | "expired";

/**
 * Target channel for approval notification
 * Extensible for future Slack/Discord integration
 */
export type ApprovalChannel = "inbox" | "slack" | "discord";

/**
 * Approval request for plan execution
 */
export interface ApprovalRequest {
    id: string;
    sessionId: string;
    projectId: string;
    /** The plan content to be approved */
    planContent: string;
    /** Summary of the plan for notification */
    planSummary: string;
    /** Status of the approval */
    status: ApprovalStatus;
    /** Where to send the notification */
    channel: ApprovalChannel;
    /** Channels to notify (always includes inbox) */
    notificationChannels?: ApprovalChannel[];
    /** Requested at timestamp */
    createdAt: number;
    /** Updated at timestamp */
    updatedAt: number;
    /** The model ID selected for execution (set when approved) */
    approvedModelId?: string;
    /** The agent mode to use for execution */
    mode?: AgentMode;
    /** Who approved/rejected (for future multi-user support) */
    respondedBy?: string;
    /** Response timestamp */
    respondedAt?: number;
    /** Optional message from the responder */
    responseMessage?: string;
}

/**
 * Data required to create a new approval request
 */
export interface CreateApprovalRequest {
    sessionId: string;
    projectId: string;
    planContent: string;
    planSummary?: string;
}

/**
 * Data required to respond to an approval request
 */
export interface ApprovalResponse {
    requestId: string;
    approved: boolean;
    modelId?: string;
    message?: string;
}
