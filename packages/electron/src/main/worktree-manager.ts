import { exec } from "node:child_process";
import { promisify } from "node:util";
import {
	getLogger,
	type Worktree,
	type WorktreeCommit,
	type WorktreeDiff,
	type WorktreeStatus,
	type WorktreeStatusEntry,
} from "@agent-manager/shared";
import { getEnhancedEnv } from "../utils/path-enhancer";

const logger = getLogger(["electron", "worktree-manager"]);

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

/**
 * Run a git gtr command and return stdout.
 */
async function runGtr(cwd: string, args: string[]): Promise<string> {
	const { stdout } = await execAsync(`git gtr ${args.join(" ")}`, { cwd });
	return stdout.trim();
}

export class WorktreeManager {
	async getWorktrees(projectRoot: string): Promise<Worktree[]> {
		try {
			const output = await runGtr(projectRoot, ["list", "--porcelain"]);
			return this.parseWorktreeList(output, projectRoot);
		} catch (error) {
			logger.error("Failed to list worktrees: {error}", { error });
			throw error;
		}
	}

	private parseWorktreeList(output: string, projectRoot: string): Worktree[] {
		const worktrees: Worktree[] = [];
		const lines = output
			.split("\n")
			.map((line) => line.trim())
			.filter(Boolean);

		for (const line of lines) {
			const [worktreePath, branch, status] = line.split("\t");
			if (!worktreePath || !branch || !status) continue;
			if (status === "missing") continue;

			const isMain = worktreePath === projectRoot;
			worktrees.push({
				id: worktreePath,
				path: worktreePath,
				branch,
				isMain,
				isLocked: status === "locked",
				prunable: status === "prunable" ? status : null,
			});
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
		try {
			if (relativePath) {
				logger.warn("relativePath is ignored when using git gtr.");
			}
			const cmd = `git gtr new ${branch}`;
			logger.debug("Executing: {cmd}", { cmd });
			await runGtr(projectRoot, ["new", branch]);

			const worktrees = await this.getWorktrees(projectRoot);
			const created = worktrees.find(
				(worktree) => worktree.branch === branch && !worktree.prunable,
			);
			if (!created) {
				throw new Error(`Worktree for branch ${branch} not found after create.`);
			}
			return created;
		} catch (error) {
			logger.error("Failed to create worktree: {error}", { error });
			throw error;
		}
	}

	async removeWorktree(
		projectRoot: string,
		worktreePath: string,
		force: boolean = false,
	): Promise<void> {
		try {
			const worktrees = await this.getWorktrees(projectRoot);
			const target = worktrees.find((worktree) => worktree.path === worktreePath);
			if (!target) {
				throw new Error(`Worktree not found for path: ${worktreePath}`);
			}
			if (target.isMain) {
				throw new Error("Cannot remove the main repository worktree.");
			}
			const cmdArgs = ["rm", target.branch];
			if (force) cmdArgs.push("--force");
			logger.debug("Executing: git gtr {args}", { args: cmdArgs.join(" ") });
			await runGtr(projectRoot, cmdArgs);
		} catch (error) {
			logger.error("Failed to remove worktree: {error}", { error });
			throw error;
		}
	}

	async pruneWorktrees(projectRoot: string): Promise<void> {
		try {
			await runGtr(projectRoot, ["clean"]);
		} catch (error) {
			logger.error("Failed to prune worktrees: {error}", { error });
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
			logger.error("Failed to get worktree status: {error}", { error });
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
			logger.error("Failed to get worktree diff: {error}", { error });
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
			logger.error("Failed to list worktree commits: {error}", { error });
			throw error;
		}
	}
}

export const worktreeManager = new WorktreeManager();
