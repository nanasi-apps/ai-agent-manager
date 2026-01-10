/**
 * IRulesResolver - Port interface for resolving project rules
 *
 * This interface defines the contract for resolving rules content
 * for a given project. The implementation handles reading global rules
 * from the file system and combining them with project-specific rules.
 *
 * Implementations are provided by the electron package.
 */

/**
 * Rules directory path - where global rules .md files are stored.
 * This is a constant that can be used by both the interface and implementations.
 */
export const RULES_DIR_NAME = ".agent-manager/rules";

export interface IRulesResolver {
	/**
	 * Resolve all applicable rules for a project.
	 *
	 * This combines:
	 * 1. Global rules from ~/.agent-manager/rules/*.md (excluding disabled ones)
	 * 2. Project-specific rules from project configuration
	 *
	 * @param projectId - The project ID to resolve rules for
	 * @returns Combined rules content as a string
	 */
	resolveProjectRules(projectId: string): Promise<string>;

	/**
	 * Get the path to the global rules directory.
	 * @returns Absolute path to the rules directory
	 */
	getRulesDir(): string;
}
