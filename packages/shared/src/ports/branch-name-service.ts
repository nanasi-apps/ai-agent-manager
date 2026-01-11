/**
 * Branch Name Service Port - Interface for branch name prompting
 *
 * This port defines the contract for branch name operations.
 * Implementation lives in the electron package.
 */

import type { BranchNameRequest } from "../types/worktree";

/**
 * Branch name event types
 */
export type BranchNameEventType = "request" | "open" | "resolved";

/**
 * Branch name request event
 */
export interface BranchNameRequestEvent {
	type: "request";
	payload: BranchNameRequest;
}

/**
 * Branch name open event (when user clicks notification)
 */
export interface BranchNameOpenEvent {
	type: "open";
	payload: { requestId: string };
}

/**
 * Branch name resolved event
 */
export interface BranchNameResolvedEvent {
	type: "resolved";
	payload: {
		requestId: string;
		branchName?: string;
		cancelled?: boolean;
	};
}

/**
 * Union of all branch name events
 */
export type BranchNameEvent =
	| BranchNameRequestEvent
	| BranchNameOpenEvent
	| BranchNameResolvedEvent;

/**
 * Result from submit/generate operations
 */
export interface BranchNameOperationResult {
	success: boolean;
	error?: string;
	request?: BranchNameRequest;
	suggestion?: string;
}

/**
 * Interface for branch name prompting service
 */
export interface IBranchNameService {
	/**
	 * List all pending branch name requests
	 */
	listPending(): BranchNameRequest[];

	/**
	 * Submit a branch name for a request
	 */
	submitBranchName(
		requestId: string,
		branchName: string,
	): BranchNameOperationResult;

	/**
	 * Generate a branch name suggestion
	 */
	generateSuggestion(requestId: string): Promise<BranchNameOperationResult>;

	/**
	 * Subscribe to branch name events
	 * @returns Unsubscribe function
	 */
	subscribe(callback: (event: BranchNameEvent) => void): () => void;
}
