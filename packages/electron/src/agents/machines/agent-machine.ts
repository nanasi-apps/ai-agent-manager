import type { AgentConfig } from "@agent-manager/shared";
import { assign, setup } from "xstate";
import type { ActiveWorktreeContext, PendingWorktreeResume } from "../types";

export interface AgentContext {
	// Core Identity
	sessionId: string;
	config: AgentConfig;

	// Execution State
	messageCount: number;
	buffer: string;
	lastUserMessage?: string;

	// Project Context
	projectRoot: string; // The original root
	activeWorktree?: ActiveWorktreeContext;
	pendingWorktreeResume?: PendingWorktreeResume;

	// Agent Specifics (Persistent across same agent type)
	geminiSessionId?: string;
	codexThreadId?: string;
	geminiHome?: string;
	claudeHome?: string;

	// Handover
	pendingHandover?: string;

	// Errors
	errorMessage?: string;

	invalidGeminiSession?: boolean;
}

export type AgentEvents =
	| { type: "USER_MESSAGE"; message: string }
	| { type: "STOP" }
	| { type: "AGENT_OUTPUT"; output: string }
	| { type: "AGENT_COMPLETE" }
	| { type: "UPDATE_CONFIG"; config: Partial<AgentConfig> }
	| { type: "WORKTREE_SWITCH_START"; context: ActiveWorktreeContext }
	| { type: "WORKTREE_SWITCH_COMPLETE" }
	| { type: "SET_GEMINI_SESSION"; id: string }
	| { type: "INVALIDATE_SESSION" }
	| { type: "SET_PENDING_HANDOVER"; context: string }
	| { type: "CONSUME_PENDING_HANDOVER" }
	| { type: "SET_PENDING_WORKTREE_RESUME"; pending: PendingWorktreeResume }
	| { type: "CLEAR_PENDING_WORKTREE_RESUME" }
	| { type: "ACTIVATE_WORKTREE"; context: ActiveWorktreeContext }
	| { type: "CLEAR_ACTIVE_WORKTREE" }
	| {
			type: "SET_AGENT_DATA";
			data: {
				geminiHome?: string;
				claudeHome?: string;
				invalidGeminiSession?: boolean;
			};
	  }
	| { type: "RESET"; config?: Partial<AgentConfig>; mode?: "soft" | "hard" };

export const agentMachine = setup({
	types: {
		context: {} as AgentContext,
		events: {} as AgentEvents,
		input: {} as {
			sessionId: string;
			config: AgentConfig;
			projectRoot?: string;
		},
	},
	actions: {
		incrementMessageCount: assign({
			messageCount: ({ context }) => context.messageCount + 1,
		}),
		resetMessageCount: assign({
			messageCount: 0,
		}),
		appendBuffer: assign({
			buffer: ({ context, event }) => {
				if (event.type === "AGENT_OUTPUT") {
					return context.buffer + event.output;
				}
				return context.buffer;
			},
		}),
		clearBuffer: assign({
			buffer: "",
		}),
		setLastUserMessage: assign({
			lastUserMessage: ({ event }) =>
				event.type === "USER_MESSAGE" ? event.message : undefined,
		}),
		updateConfig: assign({
			config: ({ context, event }) => {
				if (event.type === "UPDATE_CONFIG") {
					return { ...context.config, ...event.config };
				}
				return context.config;
			},
		}),
		setGeminiSession: assign({
			geminiSessionId: ({ event }) =>
				event.type === "SET_GEMINI_SESSION" ? event.id : undefined,
		}),
		invalidateSession: assign({
			geminiSessionId: undefined,
			messageCount: 0,
			buffer: "",
			errorMessage: undefined, // Maybe?
		}),
		setAgentData: assign({
			geminiHome: ({ context, event }) =>
				event.type === "SET_AGENT_DATA" && event.data.geminiHome !== undefined
					? event.data.geminiHome
					: context.geminiHome,
			claudeHome: ({ context, event }) =>
				event.type === "SET_AGENT_DATA" && event.data.claudeHome !== undefined
					? event.data.claudeHome
					: context.claudeHome,
			invalidGeminiSession: ({ context, event }) =>
				event.type === "SET_AGENT_DATA" &&
				event.data.invalidGeminiSession !== undefined
					? event.data.invalidGeminiSession
					: context.invalidGeminiSession,
		}),
		setPendingHandover: assign({
			pendingHandover: ({ event }) =>
				event.type === "SET_PENDING_HANDOVER" ? event.context : undefined,
		}),
		consumePendingHandover: assign({
			pendingHandover: undefined,
		}),
		setPendingWorktreeResume: assign({
			pendingWorktreeResume: ({ event }) =>
				event.type === "SET_PENDING_WORKTREE_RESUME"
					? event.pending
					: undefined,
		}),
		clearPendingWorktreeResume: assign({
			pendingWorktreeResume: undefined,
		}),
		activateWorktree: assign({
			activeWorktree: ({ event }) =>
				event.type === "ACTIVATE_WORKTREE" ? event.context : undefined,
			config: ({ context, event }) =>
				event.type === "ACTIVATE_WORKTREE"
					? { ...context.config, cwd: event.context.cwd }
					: context.config,
		}),
		clearActiveWorktree: assign({
			activeWorktree: undefined,
			config: ({ context }) => ({
				...context.config,
				cwd: context.projectRoot,
			}), // Fallback to project root
		}),
	},
}).createMachine({
	id: "agent",
	initial: "idle",
	context: ({
		input,
	}: {
		input: { sessionId: string; config: AgentConfig; projectRoot?: string };
	}) => ({
		sessionId: input.sessionId,
		config: input.config,
		projectRoot: input.projectRoot ?? input.config.cwd ?? ".",
		messageCount: 0,
		buffer: "",
	}),
	states: {
		idle: {
			on: {
				USER_MESSAGE: {
					target: "processing",
					actions: ["setLastUserMessage", "clearBuffer"],
				},
				UPDATE_CONFIG: {
					actions: "updateConfig",
				},
				SET_AGENT_DATA: { actions: "setAgentData" },
				SET_PENDING_HANDOVER: { actions: "setPendingHandover" },
				CONSUME_PENDING_HANDOVER: { actions: "consumePendingHandover" },
				SET_PENDING_WORKTREE_RESUME: { actions: "setPendingWorktreeResume" },
				CLEAR_PENDING_WORKTREE_RESUME: {
					actions: "clearPendingWorktreeResume",
				},
				ACTIVATE_WORKTREE: { actions: "activateWorktree" },
				CLEAR_ACTIVE_WORKTREE: { actions: "clearActiveWorktree" },
				SET_GEMINI_SESSION: { actions: "setGeminiSession" }, // Added to idle
				INVALIDATE_SESSION: { actions: "invalidateSession" }, // Added to idle
				RESET: {
					target: "idle",
					actions: assign(({ context, event }) => {
						const baseUpdate = {
							messageCount: 0,
							buffer: "",
							config: event.config
								? { ...context.config, ...event.config }
								: context.config,
						};

						if (event.mode === "soft") {
							return baseUpdate;
						}

						// Hard reset (default)
						return {
							...baseUpdate,
							geminiSessionId: undefined,
							codexThreadId: undefined,
							geminiHome: undefined,
							claudeHome: undefined,
							lastUserMessage: undefined,
							errorMessage: undefined,
						};
					}),
				},
			},
		},
		processing: {
			entry: "incrementMessageCount",
			on: {
				STOP: "idle",
				AGENT_OUTPUT: {
					actions: "appendBuffer",
				},
				AGENT_COMPLETE: "idle",
				SET_GEMINI_SESSION: { actions: "setGeminiSession" },
				SET_AGENT_DATA: { actions: "setAgentData" },
				INVALIDATE_SESSION: { actions: "invalidateSession" },
			},
		},
		worktreeSwitching: {
			// Placeholder for worktree logic
			on: {
				WORKTREE_SWITCH_COMPLETE: "idle",
			},
		},
	},
});
