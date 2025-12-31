import { exec } from "node:child_process";
import * as path from "node:path";
import { promisify } from "node:util";
import type {
	Worktree,
	WorktreeCommit,
	WorktreeDiff,
	WorktreeStatus,
	WorktreeStatusEntry,
} from "@agent-manager/shared";
import { getEnhancedEnv } from "../utils/path-enhancer";

const execAsyncBase = promisify(exec);

/**
 * Execute a command with enhanced PATH.
 */
async function execAsync(command: string, options: { cwd: string }) {
	return execAsyncBase(command, {
		...options,
		env: getEnhancedEnv(),
	});
}

/**
 * Run a git command and return stdout.
 */
async function runGit(cwd: string, args: string[]): Promise<string> {
	const { stdout } = await execAsync(`git ${args.join(" ")}`, { cwd });
	return stdout.trim();
}

export class WorktreeManager {
	async getWorktrees(projectRoot: string): Promise<Worktree[]> {
		try {
			const { stdout } = await execAsync("git worktree list --porcelain", {
				cwd: projectRoot,
			});
			return this.parseWorktreeList(stdout);
		} catch (error) {
			console.error("[WorktreeManager] Failed to list worktrees:", error);
			throw error;
		}
	}

	private parseWorktreeList(output: string): Worktree[] {
		const worktrees: Worktree[] = [];
		const blocks = output.trim().split("\n\n");

		for (const block of blocks) {
			const lines = block.split("\n");
			const data: any = {};

			for (const line of lines) {
				const [key, ...values] = line.split(" ");
				const value = values.join(" ");
				data[key] = value;
			}

			if (data.worktree) {
				worktrees.push({
					id: data.worktree,
					path: data.worktree,
					branch: data.branch
						? data.branch.replace("refs/heads/", "")
						: data.HEAD || "detached",
					isMain: false, // logic to determine main? usually the first one but not guaranteed by porcelain?
					// usually the one matching the repo root is main
					// We'll update isMain logic later if needed
					isLocked: !!data.locked,
					prunable: data.prunable || null,
				});
			}
		}

		// Basic heuristic: Shortest path is usually main? Or check .git folder vs file?
		// For now, let's assume the first one listed is main (git behavior)
		if (worktrees.length > 0) {
			worktrees[0].isMain = true;
		}

		return worktrees;
	}

	private parseStatusOutput(output: string): WorktreeStatus {
		const lines = output.split("\n").filter(Boolean);
		const header = lines.shift() ?? "";
		let branch = "unknown";
		let upstream: string | undefined;
		let ahead = 0;
		let behind = 0;

		if (header.startsWith("##")) {
			const info = header.slice(2).trim();
			const [branchPart, rest] = info.split("...");
			branch = branchPart.trim() || branch;
			if (rest) {
				const [upstreamPart] = rest.trim().split(" ");
				upstream = upstreamPart?.trim() || undefined;
			}
			const aheadMatch = info.match(/ahead (\d+)/);
			const behindMatch = info.match(/behind (\d+)/);
			if (aheadMatch) ahead = Number(aheadMatch[1]);
			if (behindMatch) behind = Number(behindMatch[1]);
		}

		const entries: WorktreeStatusEntry[] = [];
		for (const line of lines) {
			const status = line.slice(0, 2).trim();
			const path = line.slice(3).trim();
			if (!path) continue;
			entries.push({ status, path });
		}

		return {
			branch,
			upstream,
			ahead,
			behind,
			entries,
			raw: output.trim(),
		};
	}

	async createWorktree(
		projectRoot: string,
		branch: string,
		relativePath?: string,
	): Promise<Worktree> {
		// default path: .worktrees/<branch>
		const targetPath = relativePath || `.worktrees/${branch}`;
		const absolutePath = path.resolve(projectRoot, targetPath);

		// Check if branch exists
		let createBranchFlag = "";
		try {
			await execAsync(`git rev-parse --verify ${branch}`, { cwd: projectRoot });
			// Branch exists, checkout it
			createBranchFlag = "";
		} catch (e) {
			// Branch does not exist, create it (-b)
			createBranchFlag = `-b ${branch}`;
		}

		try {
			const cmd = `git worktree add ${createBranchFlag} "${targetPath}" ${branch}`;
			console.log(`[WorktreeManager] Executing: ${cmd}`);
			await execAsync(cmd, { cwd: projectRoot });

			// Return the new worktree object
			// We can fetch list again or construct it manually
			return {
				id: absolutePath,
				path: absolutePath,
				branch: branch,
				isMain: false,
				isLocked: false,
				prunable: null,
			};
		} catch (error) {
			console.error("[WorktreeManager] Failed to create worktree:", error);
			throw error;
		}
	}

	async removeWorktree(
		projectRoot: string,
		worktreePath: string,
		force: boolean = false,
	): Promise<void> {
		try {
			const cmd = `git worktree remove ${force ? "--force" : ""} "${worktreePath}"`;
			console.log(`[WorktreeManager] Executing: ${cmd}`);
			await execAsync(cmd, { cwd: projectRoot });
		} catch (error) {
			console.error("[WorktreeManager] Failed to remove worktree:", error);
			throw error;
		}
	}

	async pruneWorktrees(projectRoot: string): Promise<void> {
		try {
			await execAsync("git worktree prune", { cwd: projectRoot });
		} catch (error) {
			console.error("[WorktreeManager] Failed to prune worktrees:", error);
			throw error;
		}
	}

	async getWorktreeStatus(worktreePath: string): Promise<WorktreeStatus> {
		try {
			const output = await runGit(worktreePath, [
				"status",
				"--porcelain=v1",
				"-b",
			]);
			return this.parseStatusOutput(output);
		} catch (error) {
			console.error("[WorktreeManager] Failed to get worktree status:", error);
			throw error;
		}
	}

	async getWorktreeDiff(worktreePath: string): Promise<WorktreeDiff> {
		try {
			const diffText = await runGit(worktreePath, ["diff", "HEAD"]);
			const untrackedOutput = await runGit(worktreePath, [
				"ls-files",
				"--others",
				"--exclude-standard",
			]);
			const untracked = untrackedOutput
				.split("\n")
				.map((line) => line.trim())
				.filter(Boolean);
			const hasChanges = diffText.trim().length > 0 || untracked.length > 0;
			return {
				text: diffText,
				hasChanges,
				untracked,
			};
		} catch (error) {
			console.error("[WorktreeManager] Failed to get worktree diff:", error);
			throw error;
		}
	}

	async listWorktreeCommits(
		worktreePath: string,
		limit: number = 20,
	): Promise<WorktreeCommit[]> {
		try {
			const format = "%H%x1f%h%x1f%an%x1f%ad%x1f%s%x1e";
			const output = await runGit(worktreePath, [
				"log",
				`-n`,
				String(limit),
				"--date=iso",
				`--pretty=format:${format}`,
			]);
			if (!output) return [];
			return output
				.split("\x1e")
				.map((entry) => entry.trim())
				.filter(Boolean)
				.map((entry) => {
					const [hash, shortHash, author, date, subject] = entry.split("\x1f");
					return {
						hash: hash || "",
						shortHash: shortHash || "",
						author: author || "",
						date: date || "",
						subject: subject || "",
					};
				});
		} catch (error) {
			console.error(
				"[WorktreeManager] Failed to list worktree commits:",
				error,
			);
			throw error;
		}
	}
}

export const worktreeManager = new WorktreeManager();
