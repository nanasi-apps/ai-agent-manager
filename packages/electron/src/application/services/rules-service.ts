/**
 * RulesService - Implementation of IRulesService for Electron
 */

import {
	mkdir,
	readdir,
	readFile,
	stat,
	unlink,
	writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { GlobalRule, IRulesService, IStore } from "@agent-manager/shared";

export function getRulesDir(): string {
	return join(homedir(), ".agent-manager", "rules");
}

export const RULES_DIR = getRulesDir();

export function createRulesService(store: IStore): IRulesService {
	// Ensure directory exists
	mkdir(RULES_DIR, { recursive: true }).catch((e) =>
		console.error("Failed to create rules dir", e),
	);

	return {
		getRulesDir(): string {
			return RULES_DIR;
		},

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

		async listGlobalRules(): Promise<GlobalRule[]> {
			await mkdir(RULES_DIR, { recursive: true });
			try {
				const files = await readdir(RULES_DIR);
				const rules: GlobalRule[] = [];
				for (const file of files) {
					if (file.endsWith(".md")) {
						const filePath = join(RULES_DIR, file);
						try {
							const stats = await stat(filePath);
							if (stats.isFile()) {
								rules.push({
									id: file,
									name: file.replace(/\.md$/, ""),
								});
							}
						} catch (e) {
							// Ignore files we can't stat
						}
					}
				}
				return rules;
			} catch (e) {
				return [];
			}
		},

		async getGlobalRule(id: string): Promise<GlobalRule | null> {
			const filePath = join(RULES_DIR, id);
			try {
				const content = await readFile(filePath, "utf-8");
				return {
					id: id,
					name: id.replace(/\.md$/, ""),
					content,
				};
			} catch (e) {
				return null;
			}
		},

		async createGlobalRule(
			name: string,
			content: string,
		): Promise<{ id: string; success: boolean }> {
			const safeName = name.replace(/[^a-zA-Z0-9_-]/g, "_");
			const filename = `${safeName}.md`;
			const filePath = join(RULES_DIR, filename);
			await mkdir(RULES_DIR, { recursive: true });
			await writeFile(filePath, content, "utf-8");
			return { id: filename, success: true };
		},

		async updateGlobalRule(id: string, content: string): Promise<boolean> {
			const filePath = join(RULES_DIR, id);
			await writeFile(filePath, content, "utf-8");
			return true;
		},

		async deleteGlobalRule(id: string): Promise<boolean> {
			const filePath = join(RULES_DIR, id);
			try {
				await unlink(filePath);
				return true;
			} catch (e) {
				return false;
			}
		},
	};
}
