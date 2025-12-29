import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import * as path from "node:path";
import { promisify } from "node:util";
import { getStoreOrThrow, type McpTool } from "@agent-manager/shared";
import { getAgentManager } from "../../agents/agent-manager";
import { splitCommand } from "../../agents/drivers/interface";
import type { InternalToolProvider } from "../types";
import { extractErrorMessage, formatOutput, getCurrentBranch } from "../utils";

const execFileAsync = promisify(execFile);

type WorktreeRunArgs = {
	repoPath: string;
	branch: string;
	command: string | string[];
	args?: string[];
};

async function getConflictedFiles(repoPath: string): Promise<string[]> {
	try {
		const { stdout } = await execFileAsync(
			"git",
			["diff", "--name-only", "--diff-filter=U"],
			{ cwd: repoPath },
		);
		return stdout
			.trim()
			.split("\n")
			.filter((s) => s);
	} catch (e) {
		return [];
	}
}

async function runGtr(repoPath: string, args: string[]) {
	try {
		const { stdout, stderr } = await execFileAsync("git", ["gtr", ...args], {
			cwd: repoPath,
		});
		return formatOutput(stdout?.toString(), stderr?.toString());
	} catch (error: any) {
		const stdout = error?.stdout?.toString();
		const stderr = error?.stderr?.toString();
		const message =
			formatOutput(stdout, stderr, "") || extractErrorMessage(error);
		if (message.includes("is not a git command")) {
			throw new Error(
				"git gtr is not installed. Install git-worktree-runner (https://github.com/coderabbitai/git-worktree-runner).",
			);
		}
		throw new Error(message);
	}
}

function buildRunCommand(input: WorktreeRunArgs): string[] {
	if (Array.isArray(input.command)) {
		if (input.command.length === 0) {
			throw new Error("command must not be empty.");
		}
		return input.command;
	}

	if (typeof input.command !== "string" || input.command.trim().length === 0) {
		throw new Error("command must be a non-empty string.");
	}

	if (input.args && input.args.length > 0) {
		return [input.command, ...input.args];
	}

	const parsed = splitCommand(input.command);
	if (!parsed.command) {
		throw new Error("command must be a non-empty string.");
	}
	return [parsed.command, ...parsed.args];
}

export class GitWorktreeProvider implements InternalToolProvider {
	async listTools(): Promise<McpTool[]> {
		return [
			{
				name: "worktree_create",
				description:
					"Create a worktree using git-worktree-runner (git gtr new <branch>)",
				inputSchema: {
					type: "object",
					properties: {
						repoPath: {
							type: "string",
							description: "Absolute path to the git repository root",
						},
						branch: {
							type: "string",
							description: "Branch name to create or checkout",
						},
						sessionId: {
							type: "string",
							description: "Agent session ID to resume in the worktree",
						},
						resume: {
							type: "boolean",
							description: "Schedule a resume in the created worktree",
						},
						resumeMessage: {
							type: "string",
							description: "Optional message to send on resume",
						},
					},
					required: ["repoPath", "branch"],
				},
				serverName: "agents-manager-mcp",
			},
			{
				name: "worktree_list",
				description:
					"List worktrees using git-worktree-runner (git gtr list --porcelain)",
				inputSchema: {
					type: "object",
					properties: {
						repoPath: {
							type: "string",
							description: "Absolute path to the git repository root",
						},
					},
					required: ["repoPath"],
				},
				serverName: "agents-manager-mcp",
			},
			{
				name: "worktree_remove",
				description:
					"Remove a worktree using git-worktree-runner (git gtr rm <branch>)",
				inputSchema: {
					type: "object",
					properties: {
						repoPath: {
							type: "string",
							description: "Absolute path to the git repository root",
						},
						branch: { type: "string", description: "Branch name to remove" },
					},
					required: ["repoPath", "branch"],
				},
				serverName: "agents-manager-mcp",
			},
			{
				name: "worktree_complete",
				description:
					"Merge a worktree branch into main and remove the worktree (git merge <branch> && git gtr rm <branch>)",
				inputSchema: {
					type: "object",
					properties: {
						repoPath: {
							type: "string",
							description: "Absolute path to the git repository root",
						},
						branch: {
							type: "string",
							description: "Branch name to merge and remove",
						},
					},
					required: ["repoPath", "branch"],
				},
				serverName: "agents-manager-mcp",
			},
			{
				name: "worktree_cleanup",
				description: "Prune worktree information using 'git worktree prune'",
				inputSchema: {
					type: "object",
					properties: {
						repoPath: {
							type: "string",
							description: "Absolute path to the git repository root",
						},
					},
					required: ["repoPath"],
				},
				serverName: "agents-manager-mcp",
			},
			{
				name: "worktree_run",
				description:
					"Run a command in a worktree using git-worktree-runner (git gtr run <branch> <cmd>)",
				inputSchema: {
					type: "object",
					properties: {
						repoPath: {
							type: "string",
							description: "Absolute path to the git repository root",
						},
						branch: {
							type: "string",
							description: "Branch name to run the command in",
						},
						command: {
							type: "string",
							description: 'Command to run (e.g. "pnpm test")',
						},
						args: {
							type: "array",
							items: { type: "string" },
							description: "Optional command arguments",
						},
					},
					required: ["repoPath", "branch", "command"],
				},
				serverName: "agents-manager-mcp",
			},
		];
	}

	async callTool(name: string, args: any): Promise<any> {
		if (!args || typeof args.repoPath !== "string") {
			throw new Error("repoPath is required.");
		}

		switch (name) {
			case "worktree_create": {
				if (!args.branch) {
					throw new Error("branch is required.");
				}
				console.log(
					`[GitWorktreeProvider] worktree_create called: branch=${args.branch}, sessionId=${args.sessionId}, resume=${args.resume}`,
				);

				const result = await runGtr(args.repoPath, ["new", args.branch]);
				console.log(`[GitWorktreeProvider] Worktree created: ${result}`);

				if (args.resume && args.sessionId) {
					// Parse the actual worktree path from git gtr output
					// The output contains "Location: /path/to/worktree" or "Worktree path: /path/to/worktree"
					let targetCwd: string | undefined;

					const locationMatch = result.match(/Location:\s*(.+)/);
					if (locationMatch) {
						targetCwd = locationMatch[1].trim();
					}

					if (!targetCwd) {
						const worktreePathMatch = result.match(
							/Worktree (?:path|created):\s*(.+)/,
						);
						if (worktreePathMatch) {
							targetCwd = worktreePathMatch[1].trim();
						}
					}

					if (!targetCwd) {
						// Fallback to the old assumption
						targetCwd = path.join(args.repoPath, ".worktrees", args.branch);
						console.warn(
							`[GitWorktreeProvider] Could not parse worktree path from output, falling back to: ${targetCwd}`,
						);
					}

					console.log(
						`[GitWorktreeProvider] Requesting worktree resume: sessionId=${args.sessionId}, cwd=${targetCwd}`,
					);

					const manager = getAgentManager();
					const scheduled = manager.requestWorktreeResume?.(args.sessionId, {
						cwd: targetCwd,
						branch: args.branch,
						repoPath: args.repoPath,
						resumeMessage: args.resumeMessage,
					});

					console.log(`[GitWorktreeProvider] Resume scheduled: ${scheduled}`);

					if (scheduled) {
						// Update the persisted conversation's cwd so it survives restarts
						try {
							getStoreOrThrow().updateConversation(args.sessionId, {
								cwd: targetCwd,
							});
						} catch (e) {
							console.warn(
								"[GitWorktreeProvider] Failed to persist cwd to conversation:",
								e,
							);
						}
						return `${result}\n\n[Agent Manager] Scheduled resume in worktree ${args.branch}`;
					}
				}

				return result;
			}
			case "worktree_list":
				return await runGtr(args.repoPath, ["list", "--porcelain"]);
			case "worktree_remove": {
				if (!args.branch) {
					throw new Error("branch is required.");
				}
				return await runGtr(args.repoPath, ["rm", args.branch]);
			}
			case "worktree_complete": {
				if (!args.branch) {
					throw new Error("branch is required.");
				}
				// 1. Merge
				try {
					await execFileAsync("git", ["merge", "--no-ff", args.branch], {
						cwd: args.repoPath,
					});
				} catch (error: any) {
					// Merge failed, likely due to conflict.
					// Strategy:
					// 1. Abort the merge in repoPath (main) to keep it clean.
					// 2. Try to merge repoPath's current branch INTO the worktree.
					// 3. If that conflicts, tell the agent to fix it there.
					// 4. If that succeeds, try merging into repoPath again (should be FF or clean).

					try {
						const stdout = error?.stdout?.toString() || "";
						if (!stdout.includes("CONFLICT")) {
							throw error; // Rethrow if it's not a conflict
						}

						// 1. Abort
						await execFileAsync("git", ["merge", "--abort"], {
							cwd: args.repoPath,
						});

						// 2. Identify worktree
						const worktreePath = path.join(
							args.repoPath,
							".worktrees",
							args.branch,
						);
						if (!existsSync(worktreePath)) {
							// If worktree doesn't exist, we can't do the reverse merge strategy.
							throw new Error(
								`Merge conflict detected and worktree ${worktreePath} not found to resolve it.`,
							);
						}

						const targetBranch = await getCurrentBranch(args.repoPath);

						// 3. Reverse Merge
						try {
							await execFileAsync("git", ["merge", targetBranch], {
								cwd: worktreePath,
							});

							// 4. Retry original merge
							// Now that worktree has merged main, merging worktree into main should be clean.
							await execFileAsync("git", ["merge", "--no-ff", args.branch], {
								cwd: args.repoPath,
							});
						} catch (reverseError: any) {
							// If reverse merge failed, it's likely a conflict in the worktree.
							const reverseStdout = reverseError?.stdout?.toString() || "";
							if (reverseStdout.includes("CONFLICT")) {
								const conflicts = await getConflictedFiles(worktreePath);
								throw new Error(
									`Merge conflict detected. I have attempted to merge '${targetBranch}' into your worktree to resolve this, but conflicts were found.\n\n` +
										`Conflicted files in worktree:\n${conflicts.map((c) => `- ${c}`).join("\n")}\n\n` +
										`Action Required: Please resolve these conflicts inside your worktree, commit the changes, and then run 'worktree_complete' again.`,
								);
							}
							throw reverseError;
						}
					} catch (innerError: any) {
						// Fallback to original error if our strategy failed unexpectedly or we rethrew
						const stdout =
							innerError?.stdout?.toString() || error?.stdout?.toString();
						const stderr =
							innerError?.stderr?.toString() || error?.stderr?.toString();
						const message =
							innerError.message ||
							`Merge failed: ${formatOutput(stdout, stderr)}`;

						// Ensure we don't wrap the detailed error we just threw
						if (
							innerError.message &&
							innerError.message.includes("Action Required")
						) {
							throw innerError;
						}
						throw new Error(message);
					}
				}
				// 2. Remove
				return await runGtr(args.repoPath, ["rm", args.branch]);
			}
			case "worktree_cleanup": {
				try {
					await execFileAsync("git", ["worktree", "prune"], {
						cwd: args.repoPath,
					});
					return "Worktrees pruned successfully.";
				} catch (error: any) {
					const stdout = error?.stdout?.toString();
					const stderr = error?.stderr?.toString();
					throw new Error(`Prune failed: ${formatOutput(stdout, stderr)}`);
				}
			}
			case "worktree_run": {
				const runArgs = args as WorktreeRunArgs;
				if (!runArgs.branch) {
					throw new Error("branch is required.");
				}
				const commandParts = buildRunCommand(runArgs);
				return await runGtr(runArgs.repoPath, [
					"run",
					runArgs.branch,
					...commandParts,
				]);
			}
			default:
				throw new Error(`Unknown tool: ${name}`);
		}
	}
}
