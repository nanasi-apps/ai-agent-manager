import { EventEmitter } from "node:events";
import type { AgentConfig, LogEvent, SessionEvent } from "@agent-manager/shared";
import { generateUUID, getLogger } from "@agent-manager/shared";
import { store } from "../../infrastructure/store/file-store";
import type { IAgentManager, WorktreeResumeRequest } from "./agent-manager";
import { OneShotSession } from "./one-shot-session";
import type { AgentStateChangePayload } from "./types";

const logger = getLogger(["electron", "oneshot-agent-manager"]);

/**
 * One-shot agent manager for CLIs that work best in non-interactive mode
 * Uses --resume for maintaining conversation context between messages
 */
export class OneShotAgentManager extends EventEmitter implements IAgentManager {
	private sessions: Map<string, OneShotSession> = new Map();

	startSession(
		sessionId: string,
		command: string,
		config?: Partial<AgentConfig>,
	) {
		if (this.sessions.has(sessionId)) {
			logger.warn("Session {sessionId} already exists.", { sessionId });
			return;
		}

		logger.info("Creating session {sessionId}", { sessionId });

		const agentConfig: AgentConfig = {
			type: config?.type ?? "custom",
			command,
			model: config?.model,
			reasoning: config?.reasoning,
			mode: config?.mode,
			cwd: config?.cwd,
			env: config?.env,
			streamJson: config?.streamJson ?? false,
			oneShotMode: config?.oneShotMode ?? true,
			rulesContent: config?.rulesContent,
			provider: config?.provider,
		};

		const persistedState = store.getConversation(sessionId)?.agentState;
		if (persistedState) {
			const ctx = (
				persistedState as {
					context?: { codexThreadId?: string; messageCount?: number };
				}
			)?.context;
			logger.info(
				"Restoring session {sessionId} with persisted state: codexThreadId={codexThreadId}, messageCount={messageCount}",
				{
					sessionId,
					codexThreadId: ctx?.codexThreadId ?? "undefined",
					messageCount: ctx?.messageCount ?? 0,
				},
			);
		}
		const session = new OneShotSession(sessionId, agentConfig, persistedState);

		// Forward logs from session
		session.on("session-event", (event: SessionEvent) => {
			this.emit("session-event", event);
		});
		session.on("state-changed", (payload: AgentStateChangePayload) => {
			this.emit("state-changed", payload);
		});

		this.sessions.set(sessionId, session);
	}

	resetSession(
		sessionId: string,
		command: string,
		config?: Partial<AgentConfig>,
	) {
		const session = this.sessions.get(sessionId);
		if (!session) {
			this.startSession(sessionId, command, config);
			return;
		}

		const nextType = config?.type ?? session.config.type;
		const shouldResetState = session.config.type !== nextType;

		const newConfig = {
			...session.config,
			...config,
			type: nextType,
			command,
		};

		if (shouldResetState) {
			session.resetStateForNewType(newConfig);
		} else {
			session.resetStateSoft(config ?? {});
			// Explicitly set command in case it wasn't in config
			session.updateConfig({ command });
		}
	}

	async sendToSession(sessionId: string, message: string) {
		const session = this.sessions.get(sessionId);
		if (!session) {
			logger.warn("Session {sessionId} not found", { sessionId });
			this.emitLog(sessionId, "[Error: Session not found]\n", "error");
			return;
		}

		await session.processMessage(message);
	}

	requestWorktreeResume(
		sessionId: string,
		request: WorktreeResumeRequest,
	): boolean {
		const session = this.sessions.get(sessionId);
		if (!session) {
			logger.warn("Worktree resume requested for missing session {sessionId}", {
				sessionId,
			});
			return false;
		}

		return session.requestWorktreeResume(request);
	}

	stopSession(sessionId: string): boolean {
		const session = this.sessions.get(sessionId);
		if (session) {
			session.stop();
			// Remove the session from the map so a new session can be created
			this.sessions.delete(sessionId);
			return true;
		}
		return false;
	}

	isProcessing(sessionId: string): boolean {
		const session = this.sessions.get(sessionId);
		return session?.isProcessing ?? false;
	}

	isRunning(sessionId: string): boolean {
		return this.sessions.has(sessionId);
	}

	listSessions(): string[] {
		return Array.from(this.sessions.keys());
	}

	getSessionMetadata(sessionId: string):
		| {
			geminiSessionId?: string;
			codexSessionId?: string;
			codexThreadId?: string;
		}
		| undefined {
		const session = this.sessions.get(sessionId);
		if (!session) return undefined;
		return {
			geminiSessionId: session.state.geminiSessionId,
			codexSessionId: session.state.codexSessionId,
			codexThreadId: session.state.codexThreadId,
		};
	}

	setPendingHandover(sessionId: string, context: string) {
		const session = this.sessions.get(sessionId);
		if (session) {
			session.setPendingHandover(context);
		}
	}

	consumePendingHandover(sessionId: string): string | undefined {
		const session = this.sessions.get(sessionId);
		return session?.consumePendingHandover();
	}

	getSessionCwd(sessionId: string): string | undefined {
		const session = this.sessions.get(sessionId);
		if (!session) return undefined;
		// Prefer activeWorktree.cwd if available, otherwise fall back to config.cwd
		return session.state.activeWorktree?.cwd ?? session.config.cwd;
	}

	getSessionHomes(
		sessionId: string,
	): { geminiHome?: string; claudeHome?: string } | undefined {
		const session = this.sessions.get(sessionId);
		if (!session) return undefined;
		return {
			geminiHome: session.state.geminiHome,
			claudeHome: session.state.claudeHome,
		};
	}

	getSessionConfig(sessionId: string): AgentConfig | undefined {
		const session = this.sessions.get(sessionId);
		return session?.config;
	}

	private emitLog(
		sessionId: string,
		data: string,
		type: LogEvent["payload"]["type"] = "text",
		raw?: unknown,
	) {
		const event: LogEvent = {
			id: generateUUID(),
			timestamp: new Date().toISOString(),
			sessionId,
			type: "log",
			payload: {
				sessionId,
				data,
				type,
				raw,
			},
		};
		this.emit("session-event", event);
	}
}

export const oneShotAgentManager = new OneShotAgentManager();
