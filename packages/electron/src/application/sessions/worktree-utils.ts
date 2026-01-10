import { statSync } from "node:fs";
import * as fs from "node:fs/promises";
import type { WorktreeResumeRequest } from "./agent-manager";
import {
	buildWorktreeInstructions,
	buildWorktreeResumeMessage,
} from "./context-builder";

/**
 * Check if a path exists and is a directory.
 */
export async function pathExists(targetPath: string): Promise<boolean> {
	try {
		const stats = await fs.stat(targetPath);
		return stats.isDirectory();
	} catch {
		return false;
	}
}

/**
 * Check if a path exists synchronously.
 */
export function pathExistsSync(targetPath: string): boolean {
	try {
		return statSync(targetPath).isDirectory();
	} catch {
		return false;
	}
}

/**
 * Resolve the working directory, with fallback logic.
 */
export async function resolveWorkingDirectory(
	requestedCwd: string | undefined,
	fallbackCwd: string | undefined,
): Promise<{ cwd: string | undefined; usedFallback: boolean }> {
	if (requestedCwd && (await pathExists(requestedCwd))) {
		return { cwd: requestedCwd, usedFallback: false };
	}

	if (fallbackCwd && (await pathExists(fallbackCwd))) {
		return { cwd: fallbackCwd, usedFallback: !!requestedCwd };
	}

	return { cwd: undefined, usedFallback: false };
}

export interface WorktreeContext {
	branch: string;
	cwd: string;
	repoPath: string;
}

export interface WorktreeResumeData {
	request: WorktreeResumeRequest;
	resumeMessage: string;
}

/**
 * Validate a worktree request path.
 */
export function validateWorktreePath(cwd: string): {
	valid: boolean;
	error?: string;
} {
	try {
		if (!statSync(cwd).isDirectory()) {
			return { valid: false, error: "Worktree path is not a directory." };
		}
		return { valid: true };
	} catch (error: unknown) {
		const message = error instanceof Error ? error.message : String(error);
		return { valid: false, error: message };
	}
}

/**
 * Build a resume message for worktree switch.
 */
export function buildResumeMessage(
	request: WorktreeResumeRequest,
	projectRoot: string | undefined,
	lastUserMessage: string | undefined,
): string {
	return buildWorktreeResumeMessage({
		branch: request.branch,
		worktreePath: request.cwd,
		projectRoot: projectRoot ?? request.repoPath,
		originalMessage: lastUserMessage,
	});
}

/**
 * Build worktree instructions for initial message.
 */
export function buildInstructions(
	sessionId: string,
	projectRoot: string | undefined,
	isInWorktree: boolean,
	projectId?: string,
	isAutoConfigured?: boolean,
): string {
	// If already in a worktree, skip instructions.
	if (isInWorktree) {
		return "";
	}

	return buildWorktreeInstructions({
		sessionId,
		projectRoot,
		projectId,
		isAutoConfigured,
	});
}
