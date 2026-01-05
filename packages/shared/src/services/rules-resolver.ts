import { readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { getStoreOrThrow } from "./dependency-container";

export const RULES_DIR = join(homedir(), ".agent-manager", "rules");

export async function resolveProjectRules(projectId: string): Promise<string> {
	const storeInstance = getStoreOrThrow();
	const project = storeInstance.getProject(projectId);
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
}
