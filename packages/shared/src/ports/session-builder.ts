/**
 * ISessionBuilder - Port interface for building agent session configurations
 *
 * This service handles the complex logic of resolving rules, prompts,
 * environment variables, and working directories for a new session.
 */

import type { AgentMode, ReasoningLevel } from "../types/agent";
import type { ProjectConfig } from "../types/project";

export interface SessionBuildParams {
	projectId: string;
	agentType: string;
	model?: string;
	mode?: AgentMode;
	reasoning?: ReasoningLevel;
	cwd?: string;
	provider?: string;
}

export interface SessionConfig {
	agentTemplate: ProjectConfig;
	rulesContent: string;
	env: Record<string, string>;
	cwd: string;
	model?: string;
	reasoning?: ReasoningLevel;
	mode?: AgentMode;
	provider?: string;
}

export interface ISessionBuilder {
	/**
	 * Build the configuration required to start an agent session.
	 * This consolidates the logic for resolving project rules, modes, and env vars.
	 */
	buildSessionConfig(params: SessionBuildParams): Promise<SessionConfig>;
}
