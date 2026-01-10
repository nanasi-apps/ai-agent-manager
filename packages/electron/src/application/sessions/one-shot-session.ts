import { type ChildProcess, spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import {
	type AgentConfig,
	type LogEvent,
	type SessionEvent,
	type SessionLifecycleEvent,
	type StateChangeEvent,
	generateUUID,
	getLogger,
	getStoreOrThrow,
} from "@agent-manager/shared";
import { createActor, type SnapshotFrom } from "xstate";
import type { WorktreeResumeRequest } from "./agent-manager";
import { isAgentType } from "./agent-type-utils";
import { DriverResolver } from "../../infrastructure/agent-drivers/driver-resolver";
import type { AgentDriverContext } from "../../infrastructure/agent-drivers/interface";
import { EnvBuilder } from "./env-builder";
import { type AgentContext, agentMachine } from "./machines/agent-machine";
import { AgentOutputParser, type ParseResult } from "./output-parser";
import {
	isGeminiApiError,
	isQuotaError,
	isSessionInvalidError,
	killChildProcess,
	killProcessGroup,
	parseQuotaResetTime,
} from "../../infrastructure/agent-drivers/process-utils";
import type { AgentStateChangePayload, SessionState } from "./types";
import {
	buildInstructions,
	buildResumeMessage,
	pathExists,
	validateWorktreePath,
} from "./worktree-utils";

const logger = getLogger(["electron", "one-shot-session"]);

type AgentMachineSnapshot = SnapshotFrom<typeof agentMachine>;

export class OneShotSession extends EventEmitter {
	private actor;
	private currentProcess?: ChildProcess;
	private parser: AgentOutputParser;

	constructor(
		public readonly sessionId: string,
		config: AgentConfig,
		persistedState?: unknown,
	) {
		super();
		const restoredState = this.normalizePersistedState(
			persistedState,
			sessionId,
			config,
		);
		this.actor = createActor(agentMachine, {
			input: {
				sessionId,
				config,
			},
			...(restoredState ? { state: restoredState } : {}),
		});
		this.actor.subscribe((snapshot) => {
			const payload: AgentStateChangePayload = {
				sessionId: this.sessionId,
				value: snapshot.value,
				context: this.buildRendererContext(snapshot.context as AgentContext),
				persistedState: this.buildPersistedStateForStore(),
			};
			// Legacy event for backward compatibility
			this.emit("state-changed", payload);

			// Typed StateChangeEvent via unified event channel
			const stateChangeEvent: StateChangeEvent = {
				id: generateUUID(),
				timestamp: new Date().toISOString(),
				sessionId: this.sessionId,
				type: "state-change",
				payload,
			};
			this.emit("session-event", stateChangeEvent);
		});
		this.actor.start();
		this.parser = new AgentOutputParser(this.sessionId);
	}

	private normalizePersistedState(
		persistedState: unknown,
		sessionId: string,
		config: AgentConfig,
	): AgentMachineSnapshot | undefined {
		if (!persistedState || typeof persistedState !== "object") {
			return undefined;
		}

		const state = persistedState as AgentMachineSnapshot & {
			context?: Partial<AgentContext>;
		};
		const persistedContext = state.context;
		if (!persistedContext || typeof persistedContext !== "object") {
			return undefined;
		}

		const persistedConfig = persistedContext.config;
		if (persistedConfig?.type && persistedConfig.type !== config.type) {
			return undefined;
		}

		const mergedConfig: AgentConfig = {
			...persistedConfig,
			...config,
			env: { ...(persistedConfig?.env ?? {}), ...(config.env ?? {}) },
		};

		const nextContext: AgentContext = {
			...persistedContext,
			sessionId,
			config: mergedConfig,
			projectRoot: persistedContext.projectRoot ?? config.cwd ?? ".",
			messageCount: persistedContext.messageCount ?? 0,
			buffer: persistedContext.buffer ?? "",
		};

		if (nextContext.activeWorktree?.cwd) {
			nextContext.config = {
				...nextContext.config,
				cwd: nextContext.activeWorktree.cwd,
			};
		}

		// If the session was processing when persisted (e.g. app crash),
		// force it to idle so it doesn't get stuck waiting for a process that doesn't exist.
		let nextValue = state.value;
		if (
			nextValue === "processing" ||
			(typeof nextValue === "object" && "processing" in nextValue)
		) {
			logger.warn(
				"Found stale 'processing' state in session {sessionId}. Resetting to 'idle'.",
				{ sessionId },
			);
			nextValue = "idle";
		}

		return {
			...state,
			value: nextValue,
			context: nextContext,
		};
	}

	private buildRendererContext(context: AgentContext): Record<string, unknown> {
		const { env: _env, ...config } = context.config;
		const pendingWorktreeResume = context.pendingWorktreeResume
			? { ...context.pendingWorktreeResume, resumeMessage: undefined }
			: undefined;

		return {
			...context,
			config,
			pendingWorktreeResume,
		};
	}

	private buildPersistedStateForStore(): unknown {
		const persisted = this.actor.getPersistedSnapshot() as
			| (AgentMachineSnapshot & { context?: AgentContext })
			| undefined;
		if (!persisted || typeof persisted !== "object") {
			return persisted;
		}

		const context = persisted.context;
		if (!context || typeof context !== "object") {
			return persisted;
		}

		const { env: _env, ...config } = context.config;

		return {
			...persisted,
			context: {
				...context,
				config,
			},
		};
	}

	get state(): SessionState {
		const snapshot = this.actor.getSnapshot();
		const ctx = snapshot.context;
		return {
			...ctx,
			isProcessing: snapshot.matches("processing"),
			currentProcess: this.currentProcess,
		};
	}

	get config(): AgentConfig {
		return this.state.config;
	}

	get isProcessing(): boolean {
		return this.actor.getSnapshot().matches("processing");
	}

	updateConfig(config: Partial<AgentConfig>) {
		this.actor.send({ type: "UPDATE_CONFIG", config });
	}

	resetStateForNewType(config: AgentConfig) {
		this.killCurrentProcess();
		this.actor.send({ type: "RESET", config, mode: "hard" });
		this.emitLifecycleEvent("reset", "Agent type changed");
	}

	resetStateSoft(config: Partial<AgentConfig>) {
		this.killCurrentProcess();
		this.actor.send({ type: "RESET", config, mode: "soft" });
		this.emitLifecycleEvent("reset", "Configuration updated");
	}

	stop() {
		this.killCurrentProcess();
		this.actor.send({ type: "STOP" });
		this.actor.send({ type: "RESET", mode: "soft" });
		this.emitLifecycleEvent("stopped", "Generation stopped by user");
		this.emitLog("\n[Generation stopped by user]\n", "system");
	}

	private killCurrentProcess() {
		killChildProcess(this.currentProcess);
		this.currentProcess = undefined;
	}

	requestWorktreeResume(request: WorktreeResumeRequest): boolean {
		const validation = validateWorktreePath(request.cwd);
		if (!validation.valid) {
			this.emitLog(
				`\n[System] Worktree resume blocked: ${validation.error}\n`,
				"system",
			);
			return false;
		}

		const resumeMessage =
			request.resumeMessage ??
			buildResumeMessage(
				request,
				this.state.projectRoot,
				this.state.lastUserMessage,
			);

		this.actor.send({
			type: "SET_PENDING_WORKTREE_RESUME",
			pending: { request, resumeMessage },
		});

		this.emitLog(
			`\n[System] Worktree resume scheduled for branch ${request.branch}. Forcing agent restart...\n`,
			"system",
		);

		const currentProcess = this.currentProcess;
		const hasProcess = currentProcess?.pid;

		if (hasProcess) {
			if (!currentProcess.killed) {
				setTimeout(() => {
					if (this.currentProcess === currentProcess && currentProcess.pid) {
						logger.debug(
							"Killing process (pid={pid}) for worktree switch in session {sessionId}",
							{ sessionId: this.sessionId, pid: currentProcess.pid },
						);
						killProcessGroup(currentProcess.pid);
					}
				}, 500);
			} else {
				logger.debug(
					"Process already marked killed; waiting for close event in session {sessionId}",
					{ sessionId: this.sessionId },
				);
			}
		} else {
			logger.debug(
				"Process not running, triggering immediate worktree resume in session {sessionId}",
				{ sessionId: this.sessionId },
			);
			setImmediate(() => {
				this.handlePendingWorktreeResume();
			});
		}

		return true;
	}

	setPendingHandover(context: string) {
		this.actor.send({ type: "SET_PENDING_HANDOVER", context });
	}

	consumePendingHandover(): string | undefined {
		const ctx = this.actor.getSnapshot().context;
		if (ctx.pendingHandover) {
			const val = ctx.pendingHandover;
			this.actor.send({ type: "CONSUME_PENDING_HANDOVER" });
			return val;
		}
		return undefined;
	}

	async processMessage(
		message: string,
		options?: { forceFresh?: boolean; resetSessionId?: boolean },
	) {
		if (this.isProcessing) {
			logger.warn("Session {sessionId} is busy", { sessionId: this.sessionId });
			this.emitLog("[Waiting for previous response...]\n", "system");
			return;
		}

		await this.validateActiveWorktree();

		const currentState = this.state;

		let systemPrompt = "";
		if (currentState.messageCount === 0) {
			const baseRules = currentState.config.rulesContent ?? "";
			const worktreeInstructions = this.getWorktreeInstructions();
			const parts = [baseRules, worktreeInstructions].filter(Boolean);
			systemPrompt = parts.join("\n\n");
			if (baseRules) {
				logger.info("Injecting rules for session {sessionId}", {
					sessionId: this.sessionId,
				});
			}
		}

		const mcpServerUrl = `http://localhost:3001/mcp/${this.sessionId}/sse`;

		try {
			const driver = DriverResolver.getDriver(currentState.config);
			const isGemini = isAgentType(currentState.config, "gemini");
			const isCodex = isAgentType(currentState.config, "codex");
			const isClaude = isAgentType(currentState.config, "claude");

			const context: AgentDriverContext = {
				sessionId: this.sessionId,
				geminiSessionId:
					options?.forceFresh || options?.resetSessionId
						? undefined
						: currentState.geminiSessionId,
				codexSessionId:
					options?.forceFresh || options?.resetSessionId
						? undefined
						: currentState.codexSessionId,
				codexThreadId: options?.forceFresh
					? undefined
					: currentState.codexThreadId,
				messageCount: currentState.messageCount,
				mcpServerUrl:
					isCodex || isGemini || isClaude ? mcpServerUrl : undefined,
			};

			const cmd = driver.getCommand(
				context,
				message,
				currentState.config,
				systemPrompt,
			);
			logger.info("Running: {command} {args}", {
				command: cmd.command,
				args: cmd.args.join(" "),
			});
			if (isCodex) {
				logger.info(
					"Codex context: messageCount={messageCount}, codexThreadId={codexThreadId}, codexSessionId={codexSessionId}",
					{
						messageCount: context.messageCount,
						codexThreadId: context.codexThreadId ?? "undefined",
						codexSessionId: context.codexSessionId ?? "undefined",
					},
				);
			}

			const envResult = await EnvBuilder.build(currentState, mcpServerUrl, {
				isGemini,
				isCodex,
				isClaude,
				mode: currentState.config.mode,
			});

			const spawnEnv = envResult.env;

			if (
				envResult.geminiHome &&
				envResult.geminiHome !== currentState.geminiHome
			) {
				this.actor.send({
					type: "SET_AGENT_DATA",
					data: { geminiHome: envResult.geminiHome },
				});
			}

			if (
				envResult.claudeHome &&
				envResult.claudeHome !== currentState.claudeHome
			) {
				this.actor.send({
					type: "SET_AGENT_DATA",
					data: { claudeHome: envResult.claudeHome },
				});
			}

			if (isGemini) {
				logger.debug(
					"Spawn Env Check: GEMINI_BASE_URL={baseUrl}, GEMINI_API_BASE={apiBase}, GEMINI_API_KEY={apiKeyStatus}",
					{
						baseUrl: spawnEnv.GEMINI_BASE_URL,
						apiBase: spawnEnv.GEMINI_API_BASE,
						apiKeyStatus: spawnEnv.GEMINI_API_KEY ? "***" : "missing",
					},
				);
			}
			const resolvedCwd = await this.resolveSessionCwd();

			if (currentState.config.cwd && !resolvedCwd) {
				return;
			}

			const finalCwd = resolvedCwd || currentState.config.cwd;

			const child = spawn(cmd.command, cmd.args, {
				cwd: finalCwd,
				env: spawnEnv,
				shell: true,
				detached: true,
			});

			this.currentProcess = child;
			this.actor.send({ type: "USER_MESSAGE", message });
			this.emitLifecycleEvent("started", "Processing user message");

			this.handleProcessOutput(child);

			child.on("close", (code) => {
				this.handleProcessClose(child, code);
			});

			child.on("error", (err) => {
				this.actor.send({ type: "STOP" });
				logger.error(
					"Failed to start subprocess for session {sessionId}: {err}",
					{ sessionId: this.sessionId, err },
				);
				this.emitLog(`Failed to start subprocess: ${err.message}`, "error");
			});
		} catch (error: unknown) {
			this.actor.send({ type: "STOP" });
			logger.error("Error running command: {error}", { error });
			this.emitLog(
				`Error: ${error instanceof Error ? error.message : String(error)}`,
				"error",
			);
		}
	}
	private handleProcessOutput(child: ChildProcess) {
		if (child.stdout) {
			child.stdout.on("data", (data) => {
				const str = data.toString();
				if (this.state.config.streamJson) {
					this.parseStreamJson(str, child);
				} else {
					this.emitLog(str, "text");
				}
			});
		}

		if (child.stderr) {
			child.stderr.on("data", (data) => {
				const str = data.toString();
				logger.debug("stderr for session {sessionId}: {str}", {
					sessionId: this.sessionId,
					str,
				});
				if (!this.state.config.streamJson) {
					this.emitLog(str, "text");
				}
				this.checkForErrors(child, str);
			});
		}
	}

	private handleProcessClose(child: ChildProcess, code: number | null) {
		logger.debug(
			"handleProcessClose called for session {sessionId}, code={code}, hasPending={hasPending}",
			{
				sessionId: this.sessionId,
				code,
				hasPending: !!this.state.pendingWorktreeResume,
			},
		);

		if (this.currentProcess !== child) {
			logger.debug(
				"Ignoring close event for session {sessionId} - process mismatch",
				{ sessionId: this.sessionId },
			);
			return;
		}

		const hasPendingResume = !!this.state.pendingWorktreeResume;

		// Transition to idle
		this.actor.send({ type: "AGENT_COMPLETE" });
		this.currentProcess = undefined;

		logger.info(
			"Process exited for session {sessionId} with code {code}, hasPendingResume={hasPendingResume}",
			{ sessionId: this.sessionId, code, hasPendingResume },
		);

		if (!hasPendingResume) {
			this.emitLog(`\n[Process exited with code ${code}]\n`, "system");
		}
		this.handlePendingWorktreeResume();
	}

	private checkForErrors(child: ChildProcess, stderr: string) {
		if (this.currentProcess !== child) return;

		const currentSessionState = this.state;

		// Check for session invalidation errors
		if (isSessionInvalidError(stderr)) {
			if (currentSessionState.geminiSessionId) {
				logger.warn(
					"Gemini session {geminiSessionId} is invalid for session {sessionId}.",
					{
						geminiSessionId: currentSessionState.geminiSessionId,
						sessionId: this.sessionId,
					},
				);
			}
			// Mark invalid and stop
			this.actor.send({ type: "INVALIDATE_SESSION" });
			this.actor.send({ type: "STOP" });
			this.currentProcess = undefined;

			this.emitLog(
				"\n[Session Error] Previous session was invalid. Restarting fresh...\n",
				"system",
			);

			// Auto-retry with the last message
			const lastMessage = this.state.lastUserMessage;
			if (lastMessage) {
				setTimeout(() => {
					void this.processMessage(lastMessage, { forceFresh: true });
				}, 0);
			}
		}

		// Check for Gemini API errors
		if (isGeminiApiError(stderr)) {
			if (isQuotaError(stderr)) {
				const resetTime = parseQuotaResetTime(stderr) ?? "some time";
				this.emitLog(
					`\n[Gemini Quota Error] API quota exhausted. Quota will reset after ${resetTime}.\n`,
					"error",
				);
			} else {
				if (currentSessionState.geminiSessionId) {
					logger.warn(
						"Gemini API error for session {sessionId}, clearing session ID.",
						{ sessionId: this.sessionId },
					);
				}
				this.actor.send({ type: "INVALIDATE_SESSION" });
				this.emitLog(
					"\n[Gemini API Error] Connection to Gemini API failed.\n",
					"error",
				);
			}
		}
	}

	private parseStreamJson(chunk: string, originProcess: ChildProcess) {
		const lines = chunk.split("\n").filter((l) => l.trim().length > 0);
		const type = this.state.config.type;

		for (const line of lines) {
			try {
				const json = JSON.parse(line);
				const result: ParseResult = this.parser.processJsonEvent(json, type);

				// Process metadata first if process matches
				if (this.currentProcess === originProcess) {
					const metadata = result.metadata;
					if (metadata.geminiSessionId) {
						this.actor.send({
							type: "SET_GEMINI_SESSION",
							id: metadata.geminiSessionId,
						});
					}
					if (metadata.codexThreadId) {
						this.actor.send({
							type: "SET_CODEX_THREAD",
							id: metadata.codexThreadId,
						});
					}
					if (metadata.codexSessionId) {
						this.actor.send({
							type: "SET_CODEX_SESSION",
							id: metadata.codexSessionId,
						});
					}
					if (metadata.sessionInvalid) {
						logger.warn(
							"Session invalid detected via JSON output for session {sessionId}",
							{ sessionId: this.sessionId },
						);
						this.actor.send({ type: "INVALIDATE_SESSION" });
						this.actor.send({ type: "STOP" });
						this.currentProcess = undefined;

						this.emitLog(
							"\n[Session Error] Previous session was invalid. Restarting fresh...\n",
							"system",
						);

						const lastMessage = this.state.lastUserMessage;
						if (lastMessage) {
							setTimeout(() => {
								void this.processMessage(lastMessage, { forceFresh: true });
							}, 0);
						}
						// Stop processing events for this chunk if invalid
						return;
					}
				}

				// Emit events
				for (const event of result.events) {
					this.emitEvent(event);
				}
			} catch {
				// Not valid JSON, ignore
			}
		}
	}

	private handlePendingWorktreeResume() {
		const pending = this.state.pendingWorktreeResume;
		logger.debug(
			"handlePendingWorktreeResume called for session {sessionId}, hasPending={hasPending}",
			{ sessionId: this.sessionId, hasPending: !!pending },
		);

		if (!pending) {
			logger.debug(
				"No pending worktree resume for session {sessionId}, skipping",
				{ sessionId: this.sessionId },
			);
			return;
		}

		if (this.isProcessing) {
			logger.debug(
				"Worktree resume deferred for session {sessionId}; agent still processing",
				{ sessionId: this.sessionId },
			);
			return;
		}

		logger.info(
			"Activating worktree for session {sessionId}: branch={branch}, cwd={cwd}",
			{
				sessionId: this.sessionId,
				branch: pending.request.branch,
				cwd: pending.request.cwd,
			},
		);

		this.actor.send({ type: "CLEAR_PENDING_WORKTREE_RESUME" });
		this.actor.send({
			type: "ACTIVATE_WORKTREE",
			context: {
				cwd: pending.request.cwd,
				branch: pending.request.branch,
				repoPath: pending.request.repoPath,
			},
		});

		this.emitLog(
			`\n[System] Switching to worktree ${pending.request.branch} at ${pending.request.cwd}\n`,
			"system",
		);

		logger.debug(
			"Calling processMessage with resume message for session {sessionId}",
			{ sessionId: this.sessionId },
		);
		void this.processMessage(pending.resumeMessage, { forceFresh: true });
	}

	private async resolveSessionCwd(): Promise<string | undefined> {
		const state = this.state;
		const requestedCwd = state.config.cwd;

		if (requestedCwd && (await pathExists(requestedCwd))) {
			return requestedCwd;
		}

		const fallbackCwd = state.projectRoot;
		if (fallbackCwd && (await pathExists(fallbackCwd))) {
			if (requestedCwd) {
				this.actor.send({
					type: "UPDATE_CONFIG",
					config: { cwd: fallbackCwd },
				});
				if (state.activeWorktree) {
					this.actor.send({ type: "CLEAR_ACTIVE_WORKTREE" });
				}
				this.emitLog(
					`\n[System] Worktree path not found. Falling back to ${fallbackCwd}\n`,
					"system",
				);
			}
			return fallbackCwd;
		}

		if (requestedCwd) {
			this.emitLog(
				`\n[System] Working directory not found: ${requestedCwd}. Using default cwd.\n`,
				"system",
			);
		}

		return undefined;
	}

	private async validateActiveWorktree(): Promise<void> {
		const state = this.state;
		if (!state.activeWorktree) return;
		const cwd = state.config.cwd;
		if (cwd && (await pathExists(cwd))) return;

		this.actor.send({ type: "CLEAR_ACTIVE_WORKTREE" });

		const fallback = state.projectRoot;
		if (fallback) {
			this.actor.send({ type: "UPDATE_CONFIG", config: { cwd: fallback } });
		}
		this.emitLog(
			`\n[System] Worktree path missing. Worktree context cleared.\n`,
			"system",
		);
	}

	private getWorktreeInstructions(): string {
		const session = this.state;
		if (session.config.mode === "regular") {
			return "";
		}

		// Get projectId and config status from conversation
		let projectId: string | undefined;
		let isAutoConfigured = false;
		try {
			const store = getStoreOrThrow();
			const conversation = store.getConversation(this.sessionId);
			if (conversation?.projectId) {
				projectId = conversation.projectId;
				const project = store.getProject(conversation.projectId);
				if (project?.autoConfig) {
					isAutoConfigured = true;
				}
			}
		} catch {
			// Store not available, skip projectId
		}

		return buildInstructions(
			this.sessionId,
			session.projectRoot ?? session.config.cwd,
			!!session.activeWorktree,
			projectId,
			isAutoConfigured,
		);
	}

	private emitLog(
		data: string,
		type: LogEvent["payload"]["type"] = "text",
		raw?: unknown,
	) {
		const resolvedType =
			type === "text" && this.state.config.mode === "plan" ? "plan" : type;

		const event: LogEvent = {
			id: generateUUID(),
			timestamp: new Date().toISOString(),
			sessionId: this.sessionId,
			type: "log",
			payload: {
				sessionId: this.sessionId,
				data,
				type: resolvedType,
				raw,
			},
		};
		this.emit("session-event", event);
	}

	private emitEvent(event: SessionEvent) {
		this.emit("session-event", event);
	}

	private emitLifecycleEvent(
		action: SessionLifecycleEvent["payload"]["action"],
		reason?: string,
	) {
		const event: SessionLifecycleEvent = {
			id: generateUUID(),
			timestamp: new Date().toISOString(),
			sessionId: this.sessionId,
			type: "session-lifecycle",
			payload: {
				action,
				reason,
			},
		};
		this.emit("session-event", event);
	}
}
