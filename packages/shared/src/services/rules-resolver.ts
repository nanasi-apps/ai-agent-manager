import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { getStoreOrThrow } from "./dependency-container";

export const RULES_DIR = join(homedir(), ".agent-manager", "rules");

export async function resolveProjectRules(projectId: string): Promise<string> {
	const storeInstance = getStoreOrThrow();
	const project = storeInstance.getProject(projectId);
	if (!project) return "";

	let globalRulesContent = "";
	if (project.activeGlobalRules && project.activeGlobalRules.length > 0) {
		for (const ruleId of project.activeGlobalRules) {
			try {
				const ruleContent = await readFile(join(RULES_DIR, ruleId), "utf-8");
				globalRulesContent += `\n\n<!-- Rule: ${ruleId} -->\n${ruleContent}`;
			} catch (e) {
				console.warn(`Failed to read rule ${ruleId}`, e);
			}
		}
	}

	let projectRulesContent = "";
	if (project.projectRules && project.projectRules.length > 0) {
		for (const rule of project.projectRules) {
			projectRulesContent += `\n\n<!-- Project Rule: ${rule.name} -->\n${rule.content}`;
		}
	}

	return `${globalRulesContent}\n\n<!-- Project Specific Rules -->\n${projectRulesContent}`.trim();
}
