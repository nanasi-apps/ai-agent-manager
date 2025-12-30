/**
 * Supported agent types
 * All agents use CLI tools. API keys are passed via environment variables where needed.
 * - gemini: Uses Gemini CLI (set GEMINI_API_KEY for API mode)
 * - codex: Uses OpenAI Codex CLI (set OPENAI_API_KEY for API mode)
 * - claude: Uses Claude CLI
 */
export type AgentType = "gemini" | "claude" | "codex" | "cat" | "custom";

export type ReasoningLevel = "low" | "middle" | "high" | "extraHigh";

/**
 * Configuration for an agent session
 */
export interface AgentConfig {
	type: AgentType;
	command: string;
	/** Optional model name for CLIs that support it */
	model?: string;
	/** Optional reasoning level for GPT-style models */
	reasoning?: ReasoningLevel;
	/** Working directory for the agent */
	cwd?: string;
	/** Environment variables to pass */
	env?: Record<string, string>;
	/** Whether to use stream-json output format (for clean message extraction) */
	streamJson?: boolean;
	/** Whether this agent uses one-shot mode (new process per message) */
	oneShotMode?: boolean;
	/** Content of rules to inject into the session */
	rulesContent?: string;
}

/**
 * Log payload emitted by agent managers
 */
export interface AgentLogPayload {
	sessionId: string;
	data: string;
	type?: "text" | "tool_call" | "tool_result" | "thinking" | "error" | "system";
	raw?: unknown;
}
