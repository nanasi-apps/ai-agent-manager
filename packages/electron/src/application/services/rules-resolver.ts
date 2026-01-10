/**
 * RulesResolver - Implementation of IRulesResolver for Electron
 *
 * This service handles resolving project rules by:
 * 1. Reading global rules from ~/.agent-manager/rules/*.md
 * 2. Filtering out disabled global rules per project settings
 * 3. Combining with project-specific rules
 */

import { readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { IRulesResolver, IStore } from "@agent-manager/shared";

/**
 * Get the path to the global rules directory.
 */
export function getRulesDir(): string {
	return join(homedir(), ".agent-manager", "rules");
}

export const RULES_DIR = getRulesDir();

/**
 * Create a RulesResolver instance with the given store.
 *
 * @param store - The store instance for accessing project configuration
 * @returns An IRulesResolver implementation
 */
export function createRulesResolver(store: IStore): IRulesResolver {
	return {
		async resolveProjectRules(projectId: string): Promise<string> {
			const project = store.getProject(projectId);
			if (!project) return "";

			const disabledSet = new Set(project.disabledGlobalRules ?? []);

			let globalRulesContent = "";
			try {
				const files = await readdir(RULES_DIR);
				for (const file of files) {
					if (!file.endsWith(".md")) continue;
					if (disabledSet.has(file)) continue;
					try {
						const ruleContent = await readFile(join(RULES_DIR, file), "utf-8");
						globalRulesContent += `\n\n<!-- Rule: ${file} -->\n${ruleContent}`;
					} catch (e) {
						console.warn(`Failed to read rule ${file}`, e);
					}
				}
			} catch (e) {
				console.warn("Failed to read rules directory", e);
			}

			let projectRulesContent = "";
			if (project.projectRules && project.projectRules.length > 0) {
				for (const rule of project.projectRules) {
					projectRulesContent += `\n\n<!-- Project Rule: ${rule.name} -->\n${rule.content}`;
				}
			}

			return `${globalRulesContent}\n\n<!-- Project Specific Rules -->\n${projectRulesContent}`.trim();
		},

		getRulesDir(): string {
			return RULES_DIR;
		},
	};
}

/**
 * Legacy function for backward compatibility.
 * Uses getStoreOrThrow() - should be migrated to use createRulesResolver.
 *
 * @deprecated Use createRulesResolver(store) instead
 */
export async function resolveProjectRules(
	store: IStore,
	projectId: string,
): Promise<string> {
	const resolver = createRulesResolver(store);
	return resolver.resolveProjectRules(projectId);
}
