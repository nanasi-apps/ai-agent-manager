/**
 * IRulesService - Port interface for managing and resolving rules
 *
 * This interface defines the contract for:
 * 1. Resolving rules for a project (consumption)
 * 2. Managing global rules (CRUD)
 */

import type { GlobalRule } from "../types/store";

export interface IRulesService {
	// --- Consumption ---
	/**
	 * Resolve all applicable rules for a project.
	 */
	resolveProjectRules(projectId: string): Promise<string>;

	/**
	 * Get the path to the global rules directory.
	 */
	getRulesDir(): string;

	// --- Management ---
	listGlobalRules(): Promise<GlobalRule[]>;
	getGlobalRule(id: string): Promise<GlobalRule | null>;
	createGlobalRule(
		name: string,
		content: string,
	): Promise<{ id: string; success: boolean }>;
	updateGlobalRule(id: string, content: string): Promise<boolean>;
	deleteGlobalRule(id: string): Promise<boolean>;
}
