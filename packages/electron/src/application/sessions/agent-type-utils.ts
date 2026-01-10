import type { AgentConfig, AgentType } from "@agent-manager/shared";
import { AGENT_TYPES } from "./constants";

export interface AgentTypeDetection {
	isGemini: boolean;
	isClaude: boolean;
	isCodex: boolean;
	isCustom: boolean;
	/** The detected agent type */
	detectedType: AgentType;
}

/**
 * Check if config matches a specific agent type
 * Uses both explicit type and command patterns
 */
export function isAgentType(
	config: AgentConfig,
	targetType: "gemini" | "codex" | "claude",
): boolean {
	const { type, command } = config;
	const normalizedCommand = command?.toLowerCase() ?? "";

	switch (targetType) {
		case "gemini":
			return (
				type === AGENT_TYPES.GEMINI ||
				normalizedCommand === "gemini" ||
				normalizedCommand.startsWith("gemini ")
			);
		case "claude":
			return (
				type === AGENT_TYPES.CLAUDE ||
				normalizedCommand === "claude" ||
				normalizedCommand.startsWith("claude ")
			);
		case "codex":
			return (
				type === AGENT_TYPES.CODEX || normalizedCommand.startsWith("codex")
			);
		default:
			return false;
	}
}

/**
 * Detect agent type from configuration
 * Checks both explicit type and command patterns
 */
export function detectAgentType(config: AgentConfig): AgentTypeDetection {
	const { type } = config;

	const isGemini = isAgentType(config, "gemini");
	const isClaude = isAgentType(config, "claude");
	const isCodex = isAgentType(config, "codex");
	const isCustom = !isGemini && !isClaude && !isCodex;

	// Determine detected type with priority
	let detectedType: AgentType = type ?? AGENT_TYPES.CUSTOM;
	if (isGemini) detectedType = AGENT_TYPES.GEMINI;
	else if (isClaude) detectedType = AGENT_TYPES.CLAUDE;
	else if (isCodex) detectedType = AGENT_TYPES.CODEX;

	return {
		isGemini,
		isClaude,
		isCodex,
		isCustom,
		detectedType,
	};
}

/**
 * Check if agent type supports MCP integration
 */
export function supportsMcpIntegration(detection: AgentTypeDetection): boolean {
	return detection.isGemini || detection.isClaude || detection.isCodex;
}
