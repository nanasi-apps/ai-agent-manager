/**
 * SessionBuilder - Implementation of ISessionBuilder
 *
 * This service handles building the configuration for agent sessions.
 *
 * Part of Milestone 4: Move shared/services into electron
 */

import {
	getAgentTemplate,
	getModePrompt,
	type IRulesResolver,
	type ISessionBuilder,
	type IStore,
	type SessionBuildParams,
	type SessionConfig,
} from "@agent-manager/shared";

/**
 * Create a SessionBuilder service instance
 *
 * @param store - Store for accessing project data
 * @param rulesResolver - Service for resolving project rules
 * @returns ISessionBuilder implementation
 */
export function createSessionBuilder(
	store: IStore,
	rulesResolver: IRulesResolver,
): ISessionBuilder {
	return {
		async buildSessionConfig(
			params: SessionBuildParams,
		): Promise<SessionConfig> {
			// Build environment variables with API credentials
			const agentTemplate = getAgentTemplate(params.agentType);
			if (!agentTemplate) {
				throw new Error(`Agent type not found: ${params.agentType}`);
			}

			// Resolve mode prompt and project rules
			const resolvedMode = params.mode ?? "regular";
			const modePrompt = getModePrompt(resolvedMode);
			// Use the injected rulesResolver instead of direct import
			const projectRules = await rulesResolver.resolveProjectRules(
				params.projectId,
			);
			const rulesContent = modePrompt
				? `${modePrompt}\n\n${projectRules}`
				: projectRules;

			// Keep existing logic for basic env if any from template
			const agentEnv: Record<string, string> = { ...agentTemplate.agent.env };

			// Determine cwd
			const project = store.getProject(params.projectId);
			const cwd =
				params.cwd || project?.rootPath || agentTemplate.agent.cwd || "";

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
		},
	};
}
