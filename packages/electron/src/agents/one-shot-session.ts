import { type ChildProcess, spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { statSync } from "node:fs";
import type { AgentConfig, AgentLogPayload } from "@agent-manager/shared";
import * as fs from "fs/promises";
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
import {
	type SessionState,
	SessionStateManager,
} from "./session-state-manager";

export class OneShotSession extends EventEmitter {
	private stateManager: SessionStateManager;
	private parser: AgentOutputParser;

	constructor(
		public readonly sessionId: string,
		config: AgentConfig,
	) {
		super();
		this.stateManager = new SessionStateManager(sessionId, config);
		this.parser = new AgentOutputParser();
	}

	get state(): SessionState {
		return this.stateManager.get();
	}

	get config(): AgentConfig {
		return this.state.config;
	}

	get isProcessing(): boolean {
		return this.state.isProcessing;
	}

	updateConfig(config: Partial<AgentConfig>) {
		this.stateManager.updateConfig(config);
	}

	resetStateForNewType(config: AgentConfig) {
		this.stateManager.resetStateForNewType(config);
	}

	resetStateSoft(config: Partial<AgentConfig>) {
		this.stateManager.resetStateSoft(config);
	}

	stop() {
		this.stateManager.stopProcessing();
		this.stateManager.clearWorktreeResume();
		this.emitLog("\n[Generation stopped by user]\n", "system");
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
		this.stateManager.setWorktreeResume({
			request,
			resumeMessage,
		});

		this.emitLog(
			`\n[System] Worktree resume scheduled for branch ${request.branch}. Forcing agent restart...\n`,
			"system",
		);

		// Check if we have a running process to kill
		const currentProcess = this.state.currentProcess;
		const isProcessRunning =
			currentProcess && currentProcess.pid && !currentProcess.killed;

		if (isProcessRunning) {
			// Force kill the current process to trigger immediate resume in the new worktree
			// Use setTimeout to allow the MCP tool response to be sent before killing
			// handleProcessClose will call handlePendingWorktreeResume which respawns with the new cwd
			setTimeout(() => {
				// Double-check the process is still the same one we intended to kill
				if (
					this.state.currentProcess === currentProcess &&
					currentProcess.pid
				) {
					console.log(
						`[OneShotSession ${this.sessionId}] Killing process (pid=${currentProcess.pid}) for worktree switch`,
					);
					// Use SIGKILL to force-kill since SIGTERM may be ignored by some CLIs
					try {
						// Kill the entire process group
						process.kill(-currentProcess.pid, "SIGKILL");
					} catch {
						// Fallback to regular kill if process group kill fails
						currentProcess.kill("SIGKILL");
					}
				}
			}, 500);
		} else {
			// Process already exited or was never started - immediately trigger the resume
			// This handles the race condition where the MCP tool response arrives after
			// the agent process has already exited
			console.log(
				`[OneShotSession ${this.sessionId}] Process not running, triggering immediate worktree resume`,
			);
			// Use setImmediate to avoid blocking the MCP response
			setImmediate(() => {
				this.handlePendingWorktreeResume();
			});
		}

		return true;
	}

	setPendingHandover(context: string) {
		this.stateManager.setPendingHandover(context);
	}

	consumePendingHandover(): string | undefined {
		return this.stateManager.consumePendingHandover();
	}

	async processMessage(message: string) {
		if (this.isProcessing) {
			console.warn(`[OneShotSession] Session ${this.sessionId} is busy`);
			this.emitLog("[Waiting for previous response...]\n", "system");
			return;
		}

		await this.validateActiveWorktree();

		// Re-get state after validation checks
		const currentState = this.state;

		let systemPrompt = "";
		if (currentState.messageCount === 0) {
			this.stateManager.resetInvalidGeminiSession();

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

		// Session-specific MCP URL for per-session tool configuration
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

			// Execute the command
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

			// Safety check if CWD resolution failed/warned but we assume it might work or we shouldn't proceed?
			// resolveSessionCwd emits logs if fails, returns undefined if strictly failed.
			if (currentState.config.cwd && !resolvedCwd) {
				// If config.cwd was set but resolvedCwd is undefined, it means strictly failed and fallback didn't work
				// The logs are already emitted by resolveSessionCwd
				return;
			}

			const finalCwd = resolvedCwd || currentState.config.cwd; // Fallback to config if resolving returned undefined (default)

			const child = spawn(cmd.command, cmd.args, {
				cwd: finalCwd,
				env: spawnEnv,
				shell: true,
				detached: true, // Create new process group for proper killing
			});

			this.stateManager.startProcessing(child, message);
			this.stateManager.incrementMessageCount();

			this.handleProcessOutput(child);

			child.on("close", (code) => {
				this.handleProcessClose(child, code);
			});

			child.on("error", (err) => {
				this.stateManager.stopProcessing();
				console.error(
					`[OneShotSession ${this.sessionId}] Failed to start subprocess.`,
					err,
				);
				this.emitLog(`Failed to start subprocess: ${err.message}`, "error");
			});
		} catch (error: any) {
			this.stateManager.stopProcessing();
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
				this.stateManager.setGeminiHome(geminiEnv.HOME);
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
				this.stateManager.setClaudeHome(claudeEnv.CLAUDE_CONFIG_DIR);
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

		if (this.state.currentProcess !== child) {
			console.log(
				`[OneShotSession ${this.sessionId}] Ignoring close event - process mismatch`,
			);
			return;
		}

		// Capture pending before stopProcessing clears currentProcess
		const hasPendingResume = !!this.state.pendingWorktreeResume;

		this.stateManager.stopProcessing();
		console.log(
			`[OneShotSession ${this.sessionId}] Process exited with code ${code}, hasPendingResume=${hasPendingResume}`,
		);

		if (!hasPendingResume) {
			this.emitLog(`\n[Process exited with code ${code}]\n`, "system");
		}
		this.handlePendingWorktreeResume();
	}

	private checkForErrors(child: ChildProcess, stderr: string) {
		if (this.state.currentProcess !== child) return;

		const currentSessionState = this.state;

		// Detect Gemini's "Invalid session identifier"
		if (
			stderr.includes("Invalid session identifier") ||
			stderr.includes("No previous sessions found")
		) {
			if (currentSessionState.geminiSessionId) {
				console.warn(
					`[OneShotSession ${this.sessionId}] Gemini session ${currentSessionState.geminiSessionId} is invalid.`,
				);
			}
			this.stateManager.markInvalidGeminiSession();
			this.stateManager.stopProcessing();

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

		// Detect Gemini API connection errors
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
				this.stateManager.markInvalidGeminiSession();
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
						this.stateManager.setGeminiSessionId(log.metadata.geminiSessionId);
					}
					if (log.metadata?.codexThreadId) {
						this.stateManager.setCodexThreadId(log.metadata.codexThreadId);
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

		this.stateManager.clearWorktreeResume();
		this.stateManager.activateWorktree({
			cwd: pending.request.cwd,
			branch: pending.request.branch,
			repoPath: pending.request.repoPath,
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
				this.stateManager.updateConfig({ cwd: fallbackCwd });
				if (state.activeWorktree) {
					this.stateManager.clearActiveWorktree();
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

		this.stateManager.clearActiveWorktree();

		const fallback = state.projectRoot;
		if (fallback) {
			this.stateManager.updateConfig({ cwd: fallback });
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
