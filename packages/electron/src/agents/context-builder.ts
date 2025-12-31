import { readFileSync } from "node:fs";
import { join } from "node:path";

const TEMPLATES_DIR = join(__dirname, "templates");

type TemplateVariables = Record<string, string | undefined>;

/**
 * Simple template engine that supports:
 * - {{variable}} - Variable substitution
 * - {{#if variable}}...{{/if}} - Conditional blocks
 */
function renderTemplate(
	template: string,
	variables: TemplateVariables,
): string {
	let result = template;

	// Process conditional blocks: {{#if variable}}...{{/if}}
	const conditionalRegex = /\{\{#if\s+(\w+)\}\}([\s\S]*?)\{\{\/if\}\}/g;
	result = result.replace(
		conditionalRegex,
		(_, varName: string, content: string) => {
			const value = variables[varName];
			return value ? content : "";
		},
	);

	// Process variable substitutions: {{variable}}
	const variableRegex = /\{\{(\w+)\}\}/g;
	result = result.replace(variableRegex, (_, varName: string) => {
		return variables[varName] ?? "";
	});

	// Clean up extra blank lines (more than 2 consecutive newlines -> 2)
	result = result.replace(/\n{3,}/g, "\n\n");

	return result.trim();
}

function loadTemplate(name: string): string {
	const filePath = join(TEMPLATES_DIR, `${name}.md`);
	return readFileSync(filePath, "utf-8");
}

// Cached templates for performance
const templateCache = new Map<string, string>();

function getTemplate(name: string): string {
	if (!templateCache.has(name)) {
		templateCache.set(name, loadTemplate(name));
	}
	return templateCache.get(name)!;
}

// --- Public API ---

export interface WorktreeInstructionsParams {
	sessionId: string;
	projectRoot?: string;
}

export function buildWorktreeInstructions(
	params: WorktreeInstructionsParams,
): string {
	const branchSuggestion = `agent/}`;
	return renderTemplate(getTemplate("worktree-instructions"), {
		sessionId: params.sessionId,
		projectRoot: params.projectRoot,
		branchSuggestion,
	});
}

export interface WorktreeResumeParams {
	branch: string;
	worktreePath: string;
	projectRoot?: string;
	originalMessage?: string;
}

export function buildWorktreeResumeMessage(
	params: WorktreeResumeParams,
): string {
	return renderTemplate(getTemplate("worktree-resume"), {
		branch: params.branch,
		worktreePath: params.worktreePath,
		projectRoot: params.projectRoot,
		originalMessage: params.originalMessage,
	});
}

// --- MCP Tool Response Templates ---

export interface ConflictResolutionParams {
	targetBranch: string;
	conflictedFiles: string[];
}

export function buildConflictResolutionMessage(
	params: ConflictResolutionParams,
): string {
	const filesList = params.conflictedFiles.map((f) => `- ${f}`).join("\n");
	return renderTemplate(getTemplate("mcp/conflict-resolution"), {
		targetBranch: params.targetBranch,
		conflictedFiles: filesList,
	});
}

export interface WorktreeCreateResultParams {
	createOutput?: string;
	worktreePath?: string;
	resumeScheduled?: boolean;
	resumeError?: string;
}

export function buildWorktreeCreateResultMessage(
	params: WorktreeCreateResultParams,
): string {
	return renderTemplate(getTemplate("mcp/worktree-create-result"), {
		createOutput: params.createOutput,
		worktreePath: params.worktreePath,
		resumeScheduled: params.resumeScheduled ? "true" : undefined,
		resumeError: params.resumeError,
	});
}
