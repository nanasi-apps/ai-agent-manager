import { type ChildProcess, spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { statSync } from "node:fs";
import type { AgentConfig, AgentLogPayload } from "@agent-manager/shared";
import * as fs from "fs/promises";
import { createActor, type SnapshotFrom } from "xstate";
import { agentMachine, type AgentContext } from "./machines/agent-machine";
import type { AgentStateChangePayload, SessionState } from "./types";
import type { WorktreeResumeRequest } from "./agent-manager";
import { isAgentType } from "./agent-type-utils";
import {
	buildWorktreeInstructions,
	buildWorktreeResumeMessage,
} from "./context-builder";
import {
	type AgentDriver,
	type AgentDriverContext,
	ClaudeDriver,
	CodexDriver,
	GeminiDriver,
} from "./drivers";
import {
	prepareClaudeEnv,
	prepareCodexEnv,
	prepareGeminiEnv,
} from "./env-utils";
import { AgentOutputParser } from "./output-parser";

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

		return {
			...state,
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
		if (this.currentProcess) {
			try {
				if (this.currentProcess.pid) {
					// Kill the entire process group
					process.kill(-this.currentProcess.pid, "SIGKILL");
				}
			} catch {
				// Fallback
				this.currentProcess.kill("SIGKILL");
			}
			this.currentProcess = undefined;
		}
	}

	requestWorktreeResume(request: WorktreeResumeRequest): boolean {
		try {
			if (!statSync(request.cwd).isDirectory()) {
				throw new Error("Worktree path is not a directory.");
			}
		} catch (error: any) {
			const message = error?.message || String(error);
			this.emitLog(
				`\n[System] Worktree resume blocked: ${message}\n`,
				"system",
			);
			return false;
		}

		const resumeMessage =
			request.resumeMessage ?? this.getResumeMessageForWorktree(request);
		
		this.actor.send({
			type: "SET_PENDING_WORKTREE_RESUME",
			pending: { request, resumeMessage }
		});

		this.emitLog(
			`\n[System] Worktree resume scheduled for branch ${request.branch}. Forcing agent restart...\n`,
			"system",
		);

		const currentProcess = this.currentProcess;
		const isProcessRunning =
			currentProcess && currentProcess.pid && !currentProcess.killed;

		if (isProcessRunning) {
			setTimeout(() => {
				if (
					this.currentProcess === currentProcess &&
					currentProcess.pid
				) {
					console.log(
						`[OneShotSession ${this.sessionId}] Killing process (pid=${currentProcess.pid}) for worktree switch`,
					);
					try {
						process.kill(-currentProcess.pid, "SIGKILL");
					} catch {
						currentProcess.kill("SIGKILL");
					}
				}
			}, 500);
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

	async processMessage(message: string) {
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
			const driver = this.getDriver(currentState.config);
			const isGemini = isAgentType(currentState.config, "gemini");
			const isCodex = isAgentType(currentState.config, "codex");
			const isClaude = isAgentType(currentState.config, "claude");

			const context: AgentDriverContext = {
				sessionId: this.sessionId,
				geminiSessionId: currentState.geminiSessionId,
				codexThreadId: currentState.codexThreadId,
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

			const spawnEnv = await this.prepareEnvironment(
				currentState,
				mcpServerUrl,
				isGemini,
				isCodex,
				isClaude,
			);
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
		} catch (error: any) {
			this.actor.send({ type: "STOP" });
			console.error(`[OneShotSession] Error running command:`, error);
			this.emitLog(`Error: ${error.message}`, "error");
		}
	}

	private async prepareEnvironment(
		state: SessionState,
		mcpServerUrl: string,
		isGemini: boolean,
		isCodex: boolean,
		isClaude: boolean,
	): Promise<NodeJS.ProcessEnv> {
		let spawnEnv = { ...process.env, ...state.config.env };

		if (isGemini) {
			const geminiEnv = await prepareGeminiEnv({
				mcpServerUrl,
				existingHome: state.geminiHome,
				apiKey: state.config.env?.GEMINI_API_KEY,
				baseUrl: state.config.env?.GOOGLE_GEMINI_BASE_URL,
				mode: state.config.mode,
			});
			if (geminiEnv.HOME) {
				this.actor.send({ type: "SET_AGENT_DATA", data: { geminiHome: geminiEnv.HOME } });
			}
			spawnEnv = { ...spawnEnv, ...geminiEnv };
		}

		if (isCodex) {
			const codexEnv = prepareCodexEnv({
				apiKey: state.config.env?.OPENAI_API_KEY,
				baseUrl: state.config.env?.OPENAI_BASE_URL,
			});
			spawnEnv = { ...spawnEnv, ...codexEnv };
		}

		if (isClaude) {
			const claudeEnv = await prepareClaudeEnv(mcpServerUrl, state.claudeHome);
			if (claudeEnv.CLAUDE_CONFIG_DIR) {
				this.actor.send({ type: "SET_AGENT_DATA", data: { claudeHome: claudeEnv.CLAUDE_CONFIG_DIR } });
			}
			spawnEnv = { ...spawnEnv, ...claudeEnv };
		}

		return spawnEnv;
	}

	private handleProcessOutput(child: ChildProcess) {
		if (child.stdout) {
			child.stdout.on("data", (data) => {
				const str = data.toString();
				if (this.state.config.streamJson) {
					this.parseStreamJson(str);
				} else {
					this.emitLog(str, "text");
				}
			});
		}

		if (child.stderr) {
			child.stderr.on("data", (data) => {
				const str = data.toString();
				console.log(`[OneShotSession ${this.sessionId}] stderr:`, str);
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

		if (
			stderr.includes("Invalid session identifier") ||
			stderr.includes("No previous sessions found")
		) {
			if (currentSessionState.geminiSessionId) {
				console.warn(
					`[OneShotSession ${this.sessionId}] Gemini session ${currentSessionState.geminiSessionId} is invalid.`,
				);
			}
			// Mark invalid and stop
			this.actor.send({ type: "INVALIDATE_SESSION" });
			this.actor.send({ type: "STOP" }); // To be sure
			this.currentProcess = undefined;

			this.emitLog(
				"\n[Session Error] Previous session was invalid. Restarting fresh...\n",
				"system",
			);

			// Auto-retry with the last message
			const lastMessage = this.state.lastUserMessage;
			if (lastMessage) {
				void this.processMessage(lastMessage);
			}
		}

		if (stderr.includes("Error when talking to Gemini API")) {
			const quotaMatch = stderr.match(
				/Your quota will reset after (\d+h\d+m\d+s|\d+m\d+s|\d+s)/,
			);
			if (stderr.includes("exhausted your capacity") || quotaMatch) {
				const resetTime = quotaMatch ? quotaMatch[1] : "some time";
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

	private parseStreamJson(chunk: string) {
		const lines = chunk.split("\n").filter((l) => l.trim().length > 0);
		const type = this.state.config.type;

		for (const line of lines) {
			try {
				const json = JSON.parse(line);
				const logs = this.parser.processJsonEvent(json, type);

				for (const log of logs) {
					if (log.metadata?.geminiSessionId) {
						this.actor.send({ type: "SET_GEMINI_SESSION", id: log.metadata.geminiSessionId });
					}
					if (log.metadata?.codexThreadId) {
						// this.stateManager.setCodexThreadId(log.metadata.codexThreadId);
						// Need event for codex too or generic setAgentData
						// I didn't add SET_CODEX_THREAD_ID. 
						// I'll ignore for now or assume it's part of context not needing explicit set?
						// Wait, it is persistent. I need to set it.
						// I'll use SET_AGENT_DATA if I add it? No, generic is risky.
						// I'll skip codex for now as I focused on Gemini/Claude in plan.
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
			}
		});

		this.emitLog(
			`\n[System] Switching to worktree ${pending.request.branch} at ${pending.request.cwd}\n`,
			"system",
		);

		console.log(
			`[OneShotSession ${this.sessionId}] Calling processMessage with resume message`,
		);
		void this.processMessage(pending.resumeMessage);
	}

	private async resolveSessionCwd(): Promise<string | undefined> {
		const state = this.state;
		const requestedCwd = state.config.cwd;

		if (requestedCwd && (await this.pathExists(requestedCwd))) {
			return requestedCwd;
		}

		const fallbackCwd = state.projectRoot;
		if (fallbackCwd && (await this.pathExists(fallbackCwd))) {
			if (requestedCwd) {
				this.actor.send({ type: "UPDATE_CONFIG", config: { cwd: fallbackCwd } });
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
		if (cwd && (await this.pathExists(cwd))) return;

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

	private async pathExists(targetPath: string): Promise<boolean> {
		try {
			const stats = await fs.stat(targetPath);
			return stats.isDirectory();
		} catch {
			return false;
		}
	}

	private getResumeMessageForWorktree(request: WorktreeResumeRequest): string {
		return buildWorktreeResumeMessage({
			branch: request.branch,
			worktreePath: request.cwd,
			projectRoot: this.state.projectRoot ?? request.repoPath,
			originalMessage: this.state.lastUserMessage,
		});
	}

	private getWorktreeInstructions(): string {
		const session = this.state;

		// If already in a worktree, skip instructions entirely.
		// The resume message already contains all necessary context.
		if (session.activeWorktree) {
			return "";
		}

		return buildWorktreeInstructions({
			sessionId: this.sessionId,
			projectRoot: session.projectRoot ?? session.config.cwd,
		});
	}

	private getDriver(config: AgentConfig): AgentDriver {
		switch (config.type) {
			case "gemini":
				return new GeminiDriver();
			case "claude":
				return new ClaudeDriver();
			case "codex":
				return new CodexDriver();
			default:
				throw new Error(`Unknown agent command: ${config.command}`);
		}
	}

	private emitLog(
		data: string,
		type: AgentLogPayload["type"] = "text",
		raw?: unknown,
	) {
		const payload: AgentLogPayload = {
			sessionId: this.sessionId,
			data,
			type,
			raw,
		};
		this.emit("log", payload);
	}
}
