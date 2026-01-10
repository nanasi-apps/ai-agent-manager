import type {
	AgentLogPayload,
	AgentStatePayload,
	BranchNameRequest,
	SessionEvent,
} from "@agent-manager/shared";

/**
 * Electron API exposed via preload script
 */
export interface ElectronAPI {
	ping: () => Promise<string>;
	getTheme: () => Promise<boolean>;
	setThemeSource: (mode: "system" | "light" | "dark") => Promise<boolean>;
	onThemeChanged: (callback: (isDark: boolean) => void) => () => void;
	onAgentLog: (callback: (payload: AgentLogPayload) => void) => () => void;
	onAgentStateChanged: (
		callback: (payload: AgentStatePayload) => void,
	) => () => void;
	onAgentEvent: (callback: (payload: SessionEvent) => void) => () => void;
	getOrpcPort: () => number;
	listBranchNameRequests: () => Promise<BranchNameRequest[]>;
	onBranchNameRequest: (
		callback: (payload: BranchNameRequest) => void,
	) => () => void;
	onBranchNameOpen: (
		callback: (payload: { requestId: string }) => void,
	) => () => void;
	onBranchNameResolved: (
		callback: (payload: {
			requestId: string;
			branchName?: string;
			cancelled?: boolean;
		}) => void,
	) => () => void;
	submitBranchName: (
		requestId: string,
		branchName: string,
	) => Promise<{
		success: boolean;
		error?: string;
		request?: BranchNameRequest;
	}>;
	generateBranchName: (
		requestId: string,
	) => Promise<{ success: boolean; error?: string; suggestion?: string }>;
}

declare global {
	interface ViewTransition {
		finished: Promise<void>;
		ready: Promise<void>;
		updateCallbackDone: Promise<void>;
		skipTransition: () => void;
	}

	interface Document {
		startViewTransition?: (
			updateCallback: () => void | Promise<void>,
		) => ViewTransition;
	}

	interface Window {
		electronAPI?: ElectronAPI;
	}
}
