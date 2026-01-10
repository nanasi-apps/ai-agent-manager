import type { AgentConfig } from "@agent-manager/shared";
import { ClaudeDriver } from "./claude";
import { CodexDriver } from "./codex";
import { GeminiDriver } from "./gemini";
import type { AgentDriver } from "./interface";

/**
 * Resolves the appropriate agent driver based on configuration.
 */
export class DriverResolver {
	/**
	 * Get the driver instance for the given configuration.
	 */
	static getDriver(config: AgentConfig): AgentDriver {
		switch (config.type) {
			case "codex":
				return new CodexDriver();
			case "claude":
				return new ClaudeDriver();
			default:
				return new GeminiDriver();
		}
	}
}
