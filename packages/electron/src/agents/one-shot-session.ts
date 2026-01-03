import { type ChildProcess, spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import {
	type AgentConfig,
	type AgentLogPayload,
	getStoreOrThrow,
} from "@agent-manager/shared";
import { createActor, type SnapshotFrom } from "xstate";
import type { WorktreeResumeRequest } from "./agent-manager";
import { isAgentType } from "./agent-type-utils";
import { DriverResolver } from "./driver-resolver";
import type { AgentDriverContext } from "./drivers/interface";
import { EnvBuilder } from "./env-builder";
import { type AgentContext, agentMachine } from "./machines/agent-machine";
import { AgentOutputParser } from "./output-parser";
import {
	isGeminiApiError,
	isQuotaError,
	isSessionInvalidError,
	killChildProcess,
	killProcessGroup,
	parseQuotaResetTime,
} from "./process-utils";
import type { AgentStateChangePayload, SessionState } from "./types";
import {
	buildInstructions,
	buildResumeMessage,
	pathExists,
	validateWorktreePath,
} from "./worktree-utils";

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
			this.emit("state-changed", payload);
		});
		this.actor.start();
		this.parser = new AgentOutputParser();
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
			console.warn(
				`[OneShotSession ${sessionId}] Found stale 'processing' state. Resetting to 'idle'.`,
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
	}

	resetStateSoft(config: Partial<AgentConfig>) {
		this.killCurrentProcess();
		this.actor.send({ type: "RESET", config, mode: "soft" });
	}

	stop() {
		this.killCurrentProcess();
		this.actor.send({ type: "STOP" });
		this.actor.send({ type: "RESET", mode: "soft" }); // Reset message count via reset? No, stop just goes to idle.
		// SessionStateManager.stopProcessing just set isProcessing=false.
		// My machine's STOP goes to idle.
		// Also clear worktree resume
		// this.stateManager.clearWorktreeResume(); -> This is in context?
		// My machine context has pendingWorktreeResume. I should clear it?
		// Maybe STOP event should clear it.
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
		const hasProcess = currentProcess && currentProcess.pid;

		if (hasProcess) {
			if (!currentProcess.killed) {
				setTimeout(() => {
					if (this.currentProcess === currentProcess && currentProcess.pid) {
						console.log(
							`[OneShotSession ${this.sessionId}] Killing process (pid=${currentProcess.pid}) for worktree switch`,
						);
						killProcessGroup(currentProcess.pid);
					}
				}, 500);
			} else {
				console.log(
					`[OneShotSession ${this.sessionId}] Process already marked killed; waiting for close event`,
				);
			}
		} else {
			console.log(
				`[OneShotSession ${this.sessionId}] Process not running, triggering immediate worktree resume`,
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
			console.warn(`[OneShotSession] Session ${this.sessionId} is busy`);
			this.emitLog("[Waiting for previous response...]\n", "system");
			return;
		}

		await this.validateActiveWorktree();

		const currentState = this.state;

		let systemPrompt = "";
		if (currentState.messageCount === 0) {
			// this.stateManager.resetInvalidGeminiSession();
			// Handled by machine logic or needs event?

			const baseRules = currentState.config.rulesContent ?? "";
			const worktreeInstructions = this.getWorktreeInstructions();
			const parts = [baseRules, worktreeInstructions].filter(Boolean);
			systemPrompt = parts.join("\n\n");
			if (baseRules) {
				console.log(
					`[OneShotSession] Injecting rules for session ${this.sessionId}`,
				);
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
			console.log(
				`[OneShotSession] Running: ${cmd.command} ${cmd.args.join(" ")}`,
			);
			if (isCodex) {
				console.log(
					`[OneShotSession] Codex context: messageCount=${context.messageCount}, codexThreadId=${context.codexThreadId ?? "undefined"}, codexSessionId=${context.codexSessionId ?? "undefined"}`,
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
				console.log(
					`[OneShotSession] Spawn Env Check: GEMINI_BASE_URL=${spawnEnv.GEMINI_BASE_URL}, GEMINI_API_BASE=${spawnEnv.GEMINI_API_BASE}, GEMINI_API_KEY=${spawnEnv.GEMINI_API_KEY ? "***" : "missing"}`,
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

			this.handleProcessOutput(child);

			child.on("close", (code) => {
				this.handleProcessClose(child, code);
			});

			child.on("error", (err) => {
				this.actor.send({ type: "STOP" }); // Or ERROR event
				console.error(
					`[OneShotSession ${this.sessionId}] Failed to start subprocess.`,
					err,
				);
				this.emitLog(`Failed to start subprocess: ${err.message}`, "error");
			});
		} catch (error: unknown) {
			this.actor.send({ type: "STOP" });
			console.error(`[OneShotSession] Error running command:`, error);
			this.emitLog(`Error: ${error instanceof Error ? error.message : String(error)}`, "error");
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
				console.log(`[OneShotSession ${this.sessionId}] stderr:`, str);
				if (!this.state.config.streamJson) {
					this.emitLog(str, "text");
				}
				this.checkForErrors(child, str);
			});
		}
	}

	private handleProcessClose(child: ChildProcess, code: number | null) {
		console.log(
			`[OneShotSession ${this.sessionId}] handleProcessClose called, code=${code}, hasPending=${!!this.state.pendingWorktreeResume}`,
		);

		if (this.currentProcess !== child) {
			console.log(
				`[OneShotSession ${this.sessionId}] Ignoring close event - process mismatch`,
			);
			return;
		}

		// Capture pending before stopping clearing currentProcess
		const hasPendingResume = !!this.state.pendingWorktreeResume;

		// Transition to idle
		this.actor.send({ type: "AGENT_COMPLETE" });
		this.currentProcess = undefined;

		console.log(
			`[OneShotSession ${this.sessionId}] Process exited with code ${code}, hasPendingResume=${hasPendingResume}`,
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
				console.warn(
					`[OneShotSession ${this.sessionId}] Gemini session ${currentSessionState.geminiSessionId} is invalid.`,
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
				// Yield to event loop to allow state updates (INVALIDATE_SESSION) to propagate
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
					console.warn(
						`[OneShotSession ${this.sessionId}] Gemini API error, clearing session ID.`,
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
				const logs = this.parser.processJsonEvent(json, type);

				for (const log of logs) {
					// Check if the process emitting this log is still the active one
					// before updating session state. This prevents race conditions
					// where a dying process (e.g. invalid session) overwrites the
					// state cleared by the error handler.
					if (this.currentProcess === originProcess) {
						if (log.metadata?.geminiSessionId) {
							this.actor.send({
								type: "SET_GEMINI_SESSION",
								id: log.metadata.geminiSessionId,
							});
						}
						if (log.metadata?.codexThreadId) {
							this.actor.send({
								type: "SET_CODEX_THREAD",
								id: log.metadata.codexThreadId,
							});
						}
						if (log.metadata?.codexSessionId) {
							this.actor.send({
								type: "SET_CODEX_SESSION",
								id: log.metadata.codexSessionId,
							});
						}
						// Handle session invalidation from JSON errors (e.g. Codex turn.failed)
						if (log.metadata?.sessionInvalid) {
							console.warn(
								`[OneShotSession ${this.sessionId}] Session invalid detected via JSON output`,
							);
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
							return; // Stop processing further logs from this dying process
						}
					}
					this.emitLog(log.data, log.type, log.raw);
				}
			} catch {
				// Not valid JSON, ignore
			}
		}
	}


	private handlePendingWorktreeResume() {
		const pending = this.state.pendingWorktreeResume;
		console.log(
			`[OneShotSession ${this.sessionId}] handlePendingWorktreeResume called, hasPending=${!!pending}`,
		);

		if (!pending) {
			console.log(
				`[OneShotSession ${this.sessionId}] No pending worktree resume, skipping`,
			);
			return;
		}

		if (this.isProcessing) {
			console.log(
				`[OneShotSession ${this.sessionId}] Worktree resume deferred; agent still processing`,
			);
			return;
		}

		console.log(
			`[OneShotSession ${this.sessionId}] Activating worktree: branch=${pending.request.branch}, cwd=${pending.request.cwd}`,
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

		console.log(
			`[OneShotSession ${this.sessionId}] Calling processMessage with resume message`,
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
		type: AgentLogPayload["type"] = "text",
		raw?: unknown,
	) {
		const resolvedType =
			type === "text" && this.state.config.mode === "plan" ? "plan" : type;
		const payload: AgentLogPayload = {
			sessionId: this.sessionId,
			data,
			type: resolvedType,
			raw,
		};
		this.emit("log", payload);
	}
}
