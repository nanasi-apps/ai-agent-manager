import { getModePrompt } from "../templates/mode-prompts";
import type { AgentMode, ReasoningLevel } from "../types/agent";
import { getAgentTemplate, type ProjectConfig } from "../types/project";
import { getStoreOrThrow } from "./dependency-container";

import { resolveProjectRules } from "./rules-resolver";

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

/**
 * Build the configuration required to start an agent session.
 * This consolidates the shared logic between createConversation and sendMessage.
 */
export async function buildSessionConfig(
	params: SessionBuildParams,
): Promise<SessionConfig> {
	const storeInstance = getStoreOrThrow();

	// Build environment variables with API credentials
	// Note: API keys are now injected at runtime by EnvBuilder to ensure they are up-to-date
	const agentTemplate = getAgentTemplate(params.agentType);
	if (!agentTemplate) {
		throw new Error(`Agent type not found: ${params.agentType}`);
	}

	// Resolve mode prompt and project rules
	const resolvedMode = params.mode ?? "regular";
	const modePrompt = getModePrompt(resolvedMode);
	const projectRules = await resolveProjectRules(params.projectId);
	const rulesContent = modePrompt
		? `${modePrompt}\n\n${projectRules}`
		: projectRules;

	// Keep existing logic for basic env if any from template
	const agentEnv: Record<string, string> = { ...agentTemplate.agent.env };

	// Determine cwd
	const project = storeInstance.getProject(params.projectId);
	const cwd = params.cwd || project?.rootPath || agentTemplate.agent.cwd || "";

	return {
		agentTemplate,
		rulesContent,
		env: { ...agentTemplate.agent.env, ...agentEnv },
		cwd,
		model: params.model,
		reasoning: params.reasoning,
		mode: resolvedMode,
		provider: params.provider,
	};
}

/**
 * Start an agent session using the provided configuration.
 */
export function startAgentSession(
	agentManager: {
		startSession: (
			sessionId: string,
			command: string,
			options: Record<string, unknown>,
		) => void;
	},
	sessionId: string,
	config: SessionConfig,
): void {
	agentManager.startSession(sessionId, config.agentTemplate.agent.command, {
		...config.agentTemplate.agent,
		model: config.model,
		reasoning: config.reasoning,
		mode: config.mode,
		cwd: config.cwd,
		rulesContent: config.rulesContent,
		env: config.env,
		provider: config.provider,
	});
}
