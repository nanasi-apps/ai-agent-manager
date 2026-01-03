import type { AgentConfig } from "@agent-manager/shared";
import type { AgentDriver } from "./drivers/interface";
import { ClaudeDriver } from "./drivers/claude";
import { CodexDriver } from "./drivers/codex";
import { GeminiDriver } from "./drivers/gemini";

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
			case "gemini":
			default:
				return new GeminiDriver();
		}
	}
}
