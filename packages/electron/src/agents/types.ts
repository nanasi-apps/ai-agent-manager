import type { ChildProcess } from "node:child_process";
import type { AgentConfig } from "@agent-manager/shared";
import type { WorktreeResumeRequest } from "./agent-manager";

export interface ActiveWorktreeContext {
	cwd: string;
	branch: string;
	repoPath: string;
}

export interface PendingWorktreeResume {
	request: WorktreeResumeRequest;
	resumeMessage: string;
}

export interface SessionState {
	config: AgentConfig;
	messageCount: number;
	buffer: string;
	isProcessing: boolean;
	currentProcess?: ChildProcess;
	sessionId: string;

	// Project context
	projectRoot?: string;
	activeWorktree?: ActiveWorktreeContext;
	pendingWorktreeResume?: PendingWorktreeResume;

	// Agent Specific
	geminiSessionId?: string;
	codexThreadId?: string;
	geminiHome?: string;
	claudeHome?: string;

	// Flags
	invalidGeminiSession?: boolean;
	pendingHandover?: string;
	lastUserMessage?: string;
}
