import { AsyncLocalStorage } from "node:async_hooks";
import { execFile } from "node:child_process";
import { homedir } from "node:os";
import { promisify } from "node:util";
import {
	getSessionMcpServersLogic,
	getStoreOrThrow,
	listMcpToolsLogic,
	mcpRouter,
} from "@agent-manager/shared";
import { StreamableHTTPTransport } from "@hono/mcp";
import { serve } from "@hono/node-server";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { existsSync } from "fs";
import * as fs from "fs/promises";
import { Hono } from "hono";
import * as path from "path";
import { z } from "zod";
import { ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { getAgentManager } from "../agents/agent-manager";
import {
	buildConflictResolutionMessage,
	buildWorktreeCreateResultMessage,
} from "../agents/context-builder";
import { splitCommand } from "../agents/drivers/interface";
import { worktreeManager } from "../main/worktree-manager";

const sessionContext = new AsyncLocalStorage<{
	sessionId: string;
	isSuperuser: boolean;
}>();

const execFileAsyncBase = promisify(execFile);

/**
 * Get an enhanced environment with PATH that includes common binary locations.
 * This is needed because Electron on macOS doesn't inherit shell PATH.
 */
function getEnhancedEnv(): NodeJS.ProcessEnv {
	if (process.platform !== "darwin") {
		return process.env;
	}

	const extraPaths = [
		"/opt/homebrew/bin", // Apple Silicon
		"/usr/local/bin", // Intel Mac
		path.join(homedir(), ".local", "bin"),
	];

	const currentPath = process.env.PATH || "";
	const pathsToAdd = extraPaths.filter((p) => !currentPath.includes(p));

	if (pathsToAdd.length === 0) {
		return process.env;
	}

	return {
		...process.env,
		PATH: [...pathsToAdd, currentPath].join(":"),
	};
}

/**
 * Execute a file with enhanced PATH.
 */
async function execFileAsync(
	command: string,
	args: string[],
	options: { cwd: string },
) {
	return execFileAsyncBase(command, args, {
		...options,
		env: getEnhancedEnv(),
	});
}

async function getCurrentBranch(repoPath: string): Promise<string> {
	const { stdout } = await execFileAsync(
		"git",
		["rev-parse", "--abbrev-ref", "HEAD"],
		{ cwd: repoPath },
	);
	return stdout.trim();
}

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

export async function startMcpServer(port: number = 3001) {
	const server = new McpServer({
		name: "agent-manager",
		version: "1.0.0",
	});

	const registerTool = (
		name: string,
		schema: { description?: string; inputSchema?: any },
		handler: (args: any, extra: any) => Promise<any>,
	) => {
		server.registerTool(name, schema, async (args: any, extra: any) => {
			const context = sessionContext.getStore();
			// console.log(`[McpServer] Tool ${name} called. SessionId: ${context?.sessionId}`);
			if (context?.sessionId) {
				const conv = getStoreOrThrow().getConversation(context.sessionId);
				// Check exact match "agents-manager-mcp-{toolName}" as stored by UI
				const key = `agents-manager-mcp-${name}`;
				if (conv?.disabledMcpTools?.includes(key)) {
					console.log(
						`[McpServer] Blocking disabled tool ${name} for session ${context.sessionId}`,
					);
					return {
						content: [
							{
								type: "text",
								text: `Tool '${name}' is disabled for this session by the user.`,
							},
						],
						isError: true,
					};
				}

				// Check Plan Mode via active session config
				const manager = getAgentManager();
				// @ts-ignore - access session safely
				const session = manager.getSession?.(context.sessionId);
				if (session?.config?.mode === "plan" || session?.config?.mode === "ask") {
					// Plan/Ask mode: strictly forbid file operations and git
					const forbiddenPatterns = [
						"read_file",
						"write_file",
						"replace_file_content",
						"git_",
						"worktree_",
						"list_directory",
						"run_command",
					];
					if (forbiddenPatterns.some((p) => name.startsWith(p))) {
						console.log(
							`[McpServer] Blocking tool ${name} for session ${context.sessionId} (${session.config.mode} Mode)`,
						);
						return {
							content: [
								{
									type: "text",
									text: `Tool '${name}' is not available in ${session.config.mode} Mode.`,
								},
							],
							isError: true,
						};
					}
				}
			}
			return handler(args, extra);
		});
	};

	const runGtr = async (repoPath: string, args: string[]) => {
		try {
			const { stdout, stderr } = await execFileAsync("git", ["gtr", ...args], {
				cwd: repoPath,
			});
			const out = stdout?.toString().trim();
			const err = stderr?.toString().trim();
			if (out && err) return `${out}\n${err}`;
			if (out) return out;
			if (err) return err;
			return "OK";
		} catch (error: any) {
			const stdout = error?.stdout?.toString();
			const stderr = error?.stderr?.toString();
			const out = stdout?.trim();
			const err = stderr?.trim();
			const message = out || err || error?.message || String(error);
			if (message.includes("is not a git command")) {
				throw new Error(
					"git gtr is not installed. Install git-worktree-runner (https://github.com/coderabbitai/git-worktree-runner).",
				);
			}
			throw new Error(message);
		}
	};

	const runGit = async (repoPath: string, args: string[]) => {
		try {
			const { stdout, stderr } = await execFileAsync("git", args, {
				cwd: repoPath,
			});
			const out = stdout?.toString().trimEnd();
			const err = stderr?.toString().trimEnd();
			if (out && err) return `${out}\n${err}`;
			if (out) return out;
			if (err) return err;
			return "OK";
		} catch (error: any) {
			const stdout = error?.stdout?.toString();
			const stderr = error?.stderr?.toString();
			const out = stdout?.trim();
			const err = stderr?.trim();
			const message = out || err || error?.message || String(error);
			throw new Error(message);
		}
	};

	// Register FS tools
	registerTool(
		"read_file",
		{
			description: "Read file contents",
			inputSchema: {
				path: z.string().describe("Absolute path to the file").optional(),
				file_path: z
					.string()
					.describe("Absolute path to the file (alias)")
					.optional(),
			},
		},
		async ({ path: pathArg, file_path: filePathArg }) => {
			const filePath = pathArg || filePathArg;
			if (!filePath) {
				return {
					content: [
						{ type: "text", text: "Error: path or file_path is required" },
					],
					isError: true,
				};
			}
			try {
				const content = await fs.readFile(filePath, "utf-8");
				return {
					content: [{ type: "text", text: content }],
				};
			} catch (error: any) {
				return {
					content: [
						{ type: "text", text: `Error reading file: ${error.message}` },
					],
					isError: true,
				};
			}
		},
	);

	registerTool(
		"write_file",
		{
			description: "Write content to a file",
			inputSchema: {
				path: z.string().describe("Absolute path to the file").optional(),
				file_path: z
					.string()
					.describe("Absolute path to the file (alias)")
					.optional(),
				content: z.string().describe("Content to write"),
			},
		},
		async ({ path: pathArg, file_path: filePathArg, content }) => {
			const filePath = pathArg || filePathArg;
			if (!filePath) {
				return {
					content: [
						{ type: "text", text: "Error: path or file_path is required" },
					],
					isError: true,
				};
			}
			try {
				await fs.mkdir(path.dirname(filePath), { recursive: true });
				await fs.writeFile(filePath, content, "utf-8");
				return {
					content: [
						{ type: "text", text: `Successfully wrote to ${filePath}` },
					],
				};
			} catch (error: any) {
				return {
					content: [
						{ type: "text", text: `Error writing file: ${error.message}` },
					],
					isError: true,
				};
			}
		},
	);

	registerTool(
		"replace_file_content",
		{
			description: "Replace content in a file",
			inputSchema: {
				path: z.string().describe("Absolute path to the file").optional(),
				file_path: z
					.string()
					.describe("Absolute path to the file (alias)")
					.optional(),
				target: z.string().describe("String to replace"),
				replacement: z.string().describe("New string"),
			},
		},
		async ({ path: pathArg, file_path: filePathArg, target, replacement }) => {
			const filePath = pathArg || filePathArg;
			if (!filePath) {
				return {
					content: [
						{ type: "text", text: "Error: path or file_path is required" },
					],
					isError: true,
				};
			}
			try {
				const content = await fs.readFile(filePath, "utf-8");
				if (!content.includes(target)) {
					return {
						content: [
							{
								type: "text",
								text: `Target string not found in file: ${filePath}`,
							},
						],
						isError: true,
					};
				}
				const newContent = content.replace(target, replacement);
				await fs.writeFile(filePath, newContent, "utf-8");
				return {
					content: [
						{
							type: "text",
							text: `Successfully replaced content in ${filePath}`,
						},
					],
				};
			} catch (error: any) {
				return {
					content: [
						{ type: "text", text: `Error replacing content: ${error.message}` },
					],
					isError: true,
				};
			}
		},
	);

	registerTool(
		"pre_file_edit",
		{
			description: "Pre-edit hook for file operations",
			inputSchema: {
				path: z.string().describe("Absolute path to the file"),
				operation: z
					.string()
					.describe("Operation name (write_file, replace_file_content, etc.)"),
				editId: z
					.string()
					.optional()
					.describe("Optional identifier to correlate with post_file_edit"),
			},
		},
		async ({ path: filePath, operation }) => {
			return {
				content: [
					{
						type: "text",
						text: `Pre-edit recorded for ${filePath} (${operation})`,
					},
				],
			};
		},
	);

	registerTool(
		"post_file_edit",
		{
			description: "Post-edit hook for file operations",
			inputSchema: {
				path: z.string().describe("Absolute path to the file"),
				operation: z
					.string()
					.describe("Operation name (write_file, replace_file_content, etc.)"),
				editId: z
					.string()
					.optional()
					.describe("Optional identifier to correlate with pre_file_edit"),
				success: z
					.boolean()
					.optional()
					.describe("Whether the operation succeeded"),
				message: z
					.string()
					.optional()
					.describe("Optional message about the operation outcome"),
			},
		},
		async ({ path: filePath, operation, success, message }) => {
			const status = success === false ? "failed" : "completed";
			const suffix = message ? `: ${message}` : "";
			return {
				content: [
					{
						type: "text",
						text: `Post-edit ${status} for ${filePath} (${operation})${suffix}`,
					},
				],
			};
		},
	);

	// Register Git tools
	registerTool(
		"git_status",
		{
			description: "Get git status for a repository",
			inputSchema: {
				repoPath: z
					.string()
					.describe("Absolute path to the git repository root"),
				short: z
					.boolean()
					.optional()
					.describe("Use short status output (default: true)"),
			},
		},
		async ({ repoPath, short }) => {
			try {
				const useShort = short ?? true;
				const args = useShort ? ["status", "-sb"] : ["status"];
				const result = await runGit(repoPath, args);
				return {
					content: [{ type: "text", text: result }],
				};
			} catch (error: any) {
				return {
					content: [
						{
							type: "text",
							text: `Error getting git status: ${error.message}`,
						},
					],
					isError: true,
				};
			}
		},
	);

	registerTool(
		"git_diff",
		{
			description: "Get git diff output",
			inputSchema: {
				repoPath: z
					.string()
					.describe("Absolute path to the git repository root"),
				staged: z
					.boolean()
					.optional()
					.describe("Show staged changes only"),
				paths: z
					.array(z.string())
					.optional()
					.describe("Optional path filters"),
			},
		},
		async ({ repoPath, staged, paths }) => {
			try {
				const args = ["diff"];
				if (staged) args.push("--staged");
				if (paths && paths.length > 0) {
					args.push("--", ...paths);
				}
				const result = await runGit(repoPath, args);
				return {
					content: [{ type: "text", text: result }],
				};
			} catch (error: any) {
				return {
					content: [
						{ type: "text", text: `Error getting git diff: ${error.message}` },
					],
					isError: true,
				};
			}
		},
	);

	registerTool(
		"git_log",
		{
			description: "Get git log output",
			inputSchema: {
				repoPath: z
					.string()
					.describe("Absolute path to the git repository root"),
				maxCount: z
					.number()
					.int()
					.optional()
					.describe("Maximum number of commits to return (default: 20)"),
				oneline: z
					.boolean()
					.optional()
					.describe("Use one-line output (default: true)"),
				paths: z
					.array(z.string())
					.optional()
					.describe("Optional path filters"),
			},
		},
		async ({ repoPath, maxCount, oneline, paths }) => {
			try {
				const limit = Math.max(1, Math.min(maxCount ?? 20, 200));
				const useOneline = oneline ?? true;
				const args = ["log", "-n", String(limit)];
				if (useOneline) args.push("--oneline");
				if (paths && paths.length > 0) {
					args.push("--", ...paths);
				}
				const result = await runGit(repoPath, args);
				return {
					content: [{ type: "text", text: result }],
				};
			} catch (error: any) {
				return {
					content: [
						{ type: "text", text: `Error getting git log: ${error.message}` },
					],
					isError: true,
				};
			}
		},
	);

	registerTool(
		"git_branch_list",
		{
			description: "List git branches",
			inputSchema: {
				repoPath: z
					.string()
					.describe("Absolute path to the git repository root"),
				all: z.boolean().optional().describe("Include remote branches"),
			},
		},
		async ({ repoPath, all }) => {
			try {
				const args = ["branch"];
				if (all) args.push("-a");
				const result = await runGit(repoPath, args);
				return {
					content: [{ type: "text", text: result }],
				};
			} catch (error: any) {
				return {
					content: [
						{ type: "text", text: `Error listing branches: ${error.message}` },
					],
					isError: true,
				};
			}
		},
	);

	registerTool(
		"git_current_branch",
		{
			description: "Get current git branch",
			inputSchema: {
				repoPath: z
					.string()
					.describe("Absolute path to the git repository root"),
			},
		},
		async ({ repoPath }) => {
			try {
				const branch = await getCurrentBranch(repoPath);
				return {
					content: [{ type: "text", text: branch }],
				};
			} catch (error: any) {
				return {
					content: [
						{
							type: "text",
							text: `Error getting current branch: ${error.message}`,
						},
					],
					isError: true,
				};
			}
		},
	);

	registerTool(
		"git_checkout",
		{
			description: "Checkout or create a git branch",
			inputSchema: {
				repoPath: z
					.string()
					.describe("Absolute path to the git repository root"),
				branch: z.string().describe("Branch name to checkout"),
				create: z
					.boolean()
					.optional()
					.describe("Create the branch if it does not exist"),
			},
		},
		async ({ repoPath, branch, create }) => {
			try {
				const normalizedBranch = branch.replace(/^refs\/heads\//, "");
				const args = ["checkout"];
				if (create) {
					args.push("-b", normalizedBranch);
				} else {
					args.push(normalizedBranch);
				}
				const result = await runGit(repoPath, args);
				return {
					content: [{ type: "text", text: result }],
				};
			} catch (error: any) {
				return {
					content: [
						{
							type: "text",
							text: `Error checking out branch: ${error.message}`,
						},
					],
					isError: true,
				};
			}
		},
	);

	registerTool(
		"git_add",
		{
			description: "Stage files for commit",
			inputSchema: {
				repoPath: z
					.string()
					.describe("Absolute path to the git repository root"),
				all: z
					.boolean()
					.optional()
					.describe("Stage all changes"),
				paths: z
					.array(z.string())
					.optional()
					.describe("Specific paths to stage"),
			},
		},
		async ({ repoPath, all, paths }) => {
			try {
				if (!all && (!paths || paths.length === 0)) {
					return {
						content: [
							{
								type: "text",
								text: "Error staging files: paths is required when all is false.",
							},
						],
						isError: true,
					};
				}
				const args = ["add"];
				if (all) {
					args.push("-A");
				} else if (paths?.length !== undefined) {
					args.push("--", ...paths);
				}

				const result = await runGit(repoPath, args);
				return {
					content: [{ type: "text", text: result }],
				};
			} catch (error: any) {
				return {
					content: [
						{ type: "text", text: `Error staging files: ${error.message}` },
					],
					isError: true,
				};
			}
		},
	);

	registerTool(
		"git_commit",
		{
			description: "Create a git commit",
			inputSchema: {
				repoPath: z
					.string()
					.describe("Absolute path to the git repository root"),
				message: z.string().describe("Commit message"),
				all: z
					.boolean()
					.optional()
					.describe("Stage all tracked files before commit"),
			},
		},
		async ({ repoPath, message, all }) => {
			try {
				if (!message.trim()) {
					return {
						content: [
							{
								type: "text",
								text: "Error creating commit: message must be non-empty.",
							},
						],
						isError: true,
					};
				}
				const args = ["commit"];
				if (all) args.push("-a");
				args.push("-m", message);
				const result = await runGit(repoPath, args);
				return {
					content: [{ type: "text", text: result }],
				};
			} catch (error: any) {
				return {
					content: [
						{ type: "text", text: `Error creating commit: ${error.message}` },
					],
					isError: true,
				};
			}
		},
	);

	registerTool(
		"git_show",
		{
			description: "Show a git object or commit",
			inputSchema: {
				repoPath: z
					.string()
					.describe("Absolute path to the git repository root"),
				revision: z
					.string()
					.optional()
					.describe("Revision to show (default: HEAD)"),
				stat: z.boolean().optional().describe("Include diffstat"),
			},
		},
		async ({ repoPath, revision, stat }) => {
			try {
				const args = ["show"];
				if (stat) args.push("--stat");
				if (revision) args.push(revision);
				const result = await runGit(repoPath, args);
				return {
					content: [{ type: "text", text: result }],
				};
			} catch (error: any) {
				return {
					content: [
						{ type: "text", text: `Error showing revision: ${error.message}` },
					],
					isError: true,
				};
			}
		},
	);

	registerTool(
		"worktree_create",
		{
			description: "Create a git worktree for a branch",
			inputSchema: {
				repoPath: z
					.string()
					.describe("Absolute path to the git repository root"),
				branch: z.string().describe("Branch name to create or checkout"),
				sessionId: z
					.string()
					.optional()
					.describe("Optional agent session ID to resume in the worktree"),
				resume: z
					.boolean()
					.optional()
					.describe("Schedule a resume in the created worktree"),
				resumeMessage: z
					.string()
					.optional()
					.describe("Optional message to send on resume"),
			},
		},
		async ({ repoPath, branch, sessionId, resume, resumeMessage }) => {
			console.log(
				`[McpServer] worktree_create called: branch=${branch}, sessionId=${sessionId}, resume=${resume}`,
			);
			const normalizedBranch = branch.replace(/^refs\/heads\//, "");
			let createOutput = "";
			let createError: string | null = null;

			try {
				console.log(
					`[McpServer] Creating worktree for branch ${normalizedBranch} in ${repoPath}`,
				);
				createOutput = await runGtr(repoPath, ["new", normalizedBranch]);
				console.log(`[McpServer] Create output: ${createOutput}`);
			} catch (error: any) {
				createError = error?.message || String(error);
				createOutput = `Error creating worktree: ${createError}`;
				console.error(`[McpServer] Create error: ${createError}`);
			}

			const resumeRequested = resume ?? Boolean(sessionId);
			console.log(
				`[McpServer] resumeRequested=${resumeRequested} (resume=${resume}, sessionId=${sessionId})`,
			);
			let worktreePath: string | undefined;
			let resumeError: string | null = null;
			let resumeScheduled = false;

			if (resumeRequested) {
				try {
					console.log(
						`[McpServer] Locating worktree for branch ${normalizedBranch}`,
					);
					const worktrees = await worktreeManager.getWorktrees(repoPath);
					console.log(
						`[McpServer] Available worktrees: ${worktrees.map((wt) => `${wt.branch}:${wt.path}`).join(", ")}`,
					);
					// Filter out prunable worktrees (directories that might have been deleted)
					worktreePath = worktrees.find(
						(wt) => wt.branch === normalizedBranch && !wt.prunable,
					)?.path;

					if (worktreePath) {
						try {
							await fs.access(worktreePath);
							console.log(
								`[McpServer] Found and verified worktree path: ${worktreePath}`,
							);
						} catch {
							// If we can't access it, assume it's invalid
							resumeError =
								resumeError ||
								`Worktree path ${worktreePath} is not accessible.`;
							console.warn(
								`[McpServer] Worktree path ${worktreePath} is not accessible.`,
							);
							worktreePath = undefined;
						}
					} else {
						console.warn(
							`[McpServer] Worktree for branch ${normalizedBranch} not found in list.`,
						);
					}
				} catch (error: any) {
					resumeError = error?.message || String(error);
					console.error(`[McpServer] Error locating worktree: ${resumeError}`);
				}

				if (!sessionId) {
					resumeError =
						resumeError || "sessionId is required to schedule resume.";
				} else if (!worktreePath) {
					resumeError =
						resumeError ||
						`Unable to locate worktree path for branch ${normalizedBranch}.`;
				} else {
					try {
						const manager = getAgentManager();
						console.log(
							`[McpServer] Requesting worktree resume for session ${sessionId} in ${worktreePath}`,
						);
						if (typeof manager.requestWorktreeResume !== "function") {
							resumeError =
								"Active agent manager does not support worktree resume.";
						} else {
							resumeScheduled = manager.requestWorktreeResume(sessionId, {
								cwd: worktreePath,
								branch: normalizedBranch,
								repoPath,
								resumeMessage,
							});
							console.log(
								`[McpServer] requestWorktreeResume returned: ${resumeScheduled}`,
							);
							if (!resumeScheduled) {
								resumeError = "Failed to schedule worktree resume.";
							} else {
								// Update the persisted conversation's cwd so it survives restarts
								try {
									getStoreOrThrow().updateConversation(sessionId, {
										cwd: worktreePath,
									});
								} catch (e) {
									console.warn(
										"[McpServer] Failed to persist cwd to conversation:",
										e,
									);
								}
							}
						}
					} catch (error: any) {
						resumeError = error?.message || String(error);
						console.error(
							`[McpServer] Error scheduling resume: ${resumeError}`,
						);
					}
				}
			}

			const resultText = buildWorktreeCreateResultMessage({
				createOutput: createOutput || undefined,
				worktreePath,
				resumeScheduled,
				resumeError: resumeError || undefined,
			});

			const isError = Boolean(
				(createError && !worktreePath) || (resumeRequested && resumeError),
			);
			return {
				content: [{ type: "text", text: resultText || "OK" }],
				isError: isError || undefined,
			};
		},
	);

	registerTool(
		"worktree_list",
		{
			description: "List all git worktrees",
			inputSchema: {
				repoPath: z
					.string()
					.describe("Absolute path to the git repository root"),
			},
		},
		async ({ repoPath }) => {
			try {
				const result = await runGtr(repoPath, ["list", "--porcelain"]);
				return {
					content: [{ type: "text", text: result }],
				};
			} catch (error: any) {
				return {
					content: [
						{ type: "text", text: `Error listing worktrees: ${error.message}` },
					],
					isError: true,
				};
			}
		},
	);

	registerTool(
		"worktree_remove",
		{
			description: "Remove a git worktree",
			inputSchema: {
				repoPath: z
					.string()
					.describe("Absolute path to the git repository root"),
				branch: z.string().describe("Branch name to remove"),
			},
		},
		async ({ repoPath, branch }) => {
			try {
				const result = await runGtr(repoPath, ["rm", branch]);
				return {
					content: [{ type: "text", text: result }],
				};
			} catch (error: any) {
				return {
					content: [
						{ type: "text", text: `Error removing worktree: ${error.message}` },
					],
					isError: true,
				};
			}
		},
	);

	registerTool(
		"worktree_complete",
		{
			description: "Merge worktree branch and remove it",
			inputSchema: {
				repoPath: z
					.string()
					.describe("Absolute path to the git repository root"),
				branch: z.string().describe("Branch name to merge and remove"),
			},
		},
		async ({ repoPath, branch }) => {
			try {
				// 1. Merge
				try {
					await execFileAsync("git", ["merge", "--no-ff", branch], {
						cwd: repoPath,
					});
				} catch (error: any) {
					const stdout = error?.stdout?.toString() || "";
					if (!stdout.includes("CONFLICT")) {
						throw error;
					}

					// 1. Abort
					await execFileAsync("git", ["merge", "--abort"], { cwd: repoPath });

					// 2. Identify worktree
					const worktreePath = path.join(repoPath, ".worktrees", branch);
					if (!existsSync(worktreePath)) {
						throw new Error(
							`Merge conflict detected and worktree ${worktreePath} not found to resolve it.`,
						);
					}

					const targetBranch = await getCurrentBranch(repoPath);

					// 3. Reverse Merge
					try {
						await execFileAsync("git", ["merge", targetBranch], {
							cwd: worktreePath,
						});

						// 4. Retry original merge
						await execFileAsync("git", ["merge", "--no-ff", branch], {
							cwd: repoPath,
						});
					} catch (reverseError: any) {
						const reverseStdout = reverseError?.stdout?.toString() || "";
						if (reverseStdout.includes("CONFLICT")) {
							const conflicts = await getConflictedFiles(worktreePath);
							const message = buildConflictResolutionMessage({
								targetBranch,
								conflictedFiles: conflicts,
							});
							return {
								content: [{ type: "text", text: message }],
								isError: true,
							};
						}
						throw reverseError;
					}
				}

				// 2. Remove
				const result = await runGtr(repoPath, ["rm", branch]);
				return {
					content: [{ type: "text", text: result }],
				};
			} catch (error: any) {
				const stdout = error?.stdout?.toString();
				const stderr = error?.stderr?.toString();
				const msg = stdout || stderr || error.message;
				return {
					content: [
						{ type: "text", text: `Error completing worktree: ${msg}` },
					],
					isError: true,
				};
			}
		},
	);

	registerTool(
		"worktree_run",
		{
			description: "Run a command in a worktree",
			inputSchema: {
				repoPath: z
					.string()
					.describe("Absolute path to the git repository root"),
				branch: z.string().describe("Branch name to run the command in"),
				command: z.string().describe('Command to run (e.g. "pnpm test")'),
				args: z
					.array(z.string())
					.optional()
					.describe("Optional command arguments"),
			},
		},
		async ({ repoPath, branch, command, args }) => {
			try {
				const commandParts =
					args && args.length > 0
						? [command, ...args]
						: (() => {
							const parsed = splitCommand(command);
							if (!parsed.command) {
								throw new Error("Command must be a non-empty string.");
							}
							return [parsed.command, ...parsed.args];
						})();
				const result = await runGtr(repoPath, ["run", branch, ...commandParts]);
				return {
					content: [{ type: "text", text: result }],
				};
			} catch (error: any) {
				return {
					content: [
						{
							type: "text",
							text: `Error running worktree command: ${error.message}`,
						},
					],
					isError: true,
				};
			}
		},
	);

	registerTool(
		"list_available_mcp_tools",
		{
			description:
				"List all available MCP tools across all configured servers for this session",
			inputSchema: {
				sessionId: z.string().describe("The current session ID"),
			},
		},
		async ({ sessionId }) => {
			try {
				const { sessionServers, globalServers } =
					await getSessionMcpServersLogic(sessionId);

				const allServers = [...sessionServers, ...globalServers];
				const allTools: any[] = [];

				for (const serverEntry of allServers) {
					// Skip ourselves to avoid redundant listing
					if (serverEntry.name === "agents-manager-mcp") continue;

					try {
						const tools = await listMcpToolsLogic(serverEntry);
						allTools.push({
							server: serverEntry.name,
							source: serverEntry.source,
							tools: tools.map((t: any) => ({
								name: t.name,
								description: t.description,
							})),
						});
					} catch (e) {
						allTools.push({
							server: serverEntry.name,
							source: serverEntry.source,
							error: String(e),
						});
					}
				}

				return {
					content: [{ type: "text", text: JSON.stringify(allTools, null, 2) }],
				};
			} catch (error: any) {
				return {
					content: [
						{ type: "text", text: `Error listing MCP tools: ${error.message}` },
					],
					isError: true,
				};
			}
		},
	);

	registerTool(
		"list_directory",
		{
			description: "List directory contents",
			inputSchema: {
				path: z.string().describe("Absolute path to the directory").optional(),
				dir_path: z
					.string()
					.describe("Absolute path to the directory (alias)")
					.optional(),
			},
		},
		async ({ path: dirPathArg, dir_path: altDirPathArg }) => {
			const dirPath = dirPathArg || altDirPathArg;
			if (!dirPath) {
				return {
					content: [
						{ type: "text", text: "Error: path or dir_path is required" },
					],
					isError: true,
				};
			}
			try {
				const files = await fs.readdir(dirPath);
				return {
					content: [{ type: "text", text: JSON.stringify(files, null, 2) }],
				};
			} catch (error: any) {
				return {
					content: [
						{ type: "text", text: `Error listing directory: ${error.message}` },
					],
					isError: true,
				};
			}
		},
	);

	const app = new Hono();

	// Setup StreamableHTTPTransport from @hono/mcp
	// Assuming constructor takes options including endpoint
	const transport = new StreamableHTTPTransport({});

	await server.connect(transport);

	// Middleware to log all requests
	app.use("*", async (c, next) => {
		console.log(`[McpServer] ${c.req.method} ${c.req.url}`);
		await next();
		console.log(`[McpServer] Response status: ${c.res.status}`);
	});

	// Override tools/list handler to filter disabled tools
	// Wrap tools/list handler to filter disabled tools
	// We wait a tick to let McpServer register its default handler, then wrap it
	setTimeout(() => {
		const internalServer = (server as any).server;
		// Access the internal request handlers map (implementation detail of @modelcontextprotocol/sdk)
		const originalHandler = internalServer._requestHandlers?.get("tools/list");

		if (originalHandler) {
			console.log("[McpServer] successfully wrapped tools/list handler");
			internalServer.setRequestHandler(ListToolsRequestSchema, async (req: any, extra: any) => {
				// Call original handler to get the full list with correct schema conversion
				const result = await originalHandler(req, extra);
				const context = sessionContext.getStore();

				if (context?.sessionId && !context.isSuperuser && result.tools) {
					const conv = getStoreOrThrow().getConversation(context.sessionId);
					if (conv?.disabledMcpTools) {
						result.tools = result.tools.filter(
							(t: any) =>
								!conv.disabledMcpTools!.includes(`agents-manager-mcp-${t.name}`),
						);
					}

					// Plan/Ask Mode: Filter out action tools from the list being returned
					const manager = getAgentManager();
					// @ts-ignore
					const session = manager.getSession?.(context.sessionId);
					if (session?.config?.mode === "plan" || session?.config?.mode === "ask") {
						result.tools = result.tools.filter((t: any) => {
							const forbiddenPatterns = [
								"read_file",
								"write_file",
								"replace_file_content",
								"git_",
								"worktree_",
								"list_directory",
								"run_command",
							];
							return !forbiddenPatterns.some((pattern) =>
								t.name.startsWith(pattern),
							);
						});
					}
				}
				return result;
			});
		} else {
			console.warn("[McpServer] Failed to wrap tools/list: original handler not found");
		}
	}, 100);

	// Session-specific MCP endpoint: /mcp/:sessionId/*
	// This allows per-session tool configuration in the future
	app.all("/mcp/:sessionId/*", async (c) => {
		const sessionId = c.req.param("sessionId");
		const isSuperuser = c.req.query("superuser") === "true";
		// console.log(
		// 	`[McpServer] Handling session-specific MCP request: sessionId=${sessionId}, superuser=${isSuperuser}, url=${c.req.url}`,
		// );
		// Run request in session context
		return sessionContext.run({ sessionId, isSuperuser }, () =>
			transport.handleRequest(c as any),
		);
	});

	// Default MCP endpoint (backward compatible)
	app.all("/mcp/*", async (c) => {
		console.log(`[McpServer] Handling MCP request: ${c.req.url}`);
		return transport.handleRequest(c as any);
	});

	// Also handle simple health check
	app.get("/health", (c) => c.text("OK"));

	console.log(`[McpServer] Starting on port ${port}`);

	// We start the server independently
	serve({
		fetch: app.fetch,
		port,
	});

	return app;
}
