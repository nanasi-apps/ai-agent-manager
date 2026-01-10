import { z } from "zod";
import { getCurrentBranch, runGit } from "../utils";
import { createSafeHandler, errorResponse } from "./safe-tool-wrapper";
import type { ToolRegistrar } from "./types";

export function registerGitTools(registerTool: ToolRegistrar) {
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
		createSafeHandler(async (rawArgs) => {
			const { repoPath, short } = rawArgs as unknown as {
				repoPath: string;
				short?: boolean;
			};
			const useShort = short ?? true;
			const args = useShort ? ["status", "-sb"] : ["status"];
			return await runGit(repoPath, args);
		}, "Error getting git status"),
	);

	registerTool(
		"git_diff",
		{
			description: "Get git diff output",
			inputSchema: {
				repoPath: z
					.string()
					.describe("Absolute path to the git repository root"),
				staged: z.boolean().optional().describe("Show staged changes only"),
				paths: z.array(z.string()).optional().describe("Optional path filters"),
			},
		},
		createSafeHandler(async (rawArgs) => {
			const { repoPath, staged, paths } = rawArgs as unknown as {
				repoPath: string;
				staged?: boolean;
				paths?: string[];
			};
			const args = ["diff"];
			if (staged) args.push("--staged");
			if (paths && paths.length > 0) {
				args.push("--", ...paths);
			}
			return await runGit(repoPath, args);
		}, "Error getting git diff"),
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
				paths: z.array(z.string()).optional().describe("Optional path filters"),
			},
		},
		createSafeHandler(async (rawArgs) => {
			const { repoPath, maxCount, oneline, paths } = rawArgs as unknown as {
				repoPath: string;
				maxCount?: number;
				oneline?: boolean;
				paths?: string[];
			};
			const limit = Math.max(1, Math.min(maxCount ?? 20, 200));
			const useOneline = oneline ?? true;
			const args = ["log", "-n", String(limit)];
			if (useOneline) args.push("--oneline");
			if (paths && paths.length > 0) {
				args.push("--", ...paths);
			}
			return await runGit(repoPath, args);
		}, "Error getting git log"),
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
		createSafeHandler(async (rawArgs) => {
			const { repoPath, all } = rawArgs as unknown as {
				repoPath: string;
				all?: boolean;
			};
			const args = ["branch"];
			if (all) args.push("-a");
			return await runGit(repoPath, args);
		}, "Error listing branches"),
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
		createSafeHandler(async (rawArgs) => {
			const { repoPath } = rawArgs as unknown as { repoPath: string };
			return await getCurrentBranch(repoPath);
		}, "Error getting current branch"),
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
		createSafeHandler(async (rawArgs) => {
			const { repoPath, branch, create } = rawArgs as unknown as {
				repoPath: string;
				branch: string;
				create?: boolean;
			};
			const normalizedBranch = branch.replace(/^refs\/heads\//, "");
			const args = ["checkout"];
			if (create) {
				args.push("-b", normalizedBranch);
			} else {
				args.push(normalizedBranch);
			}
			return await runGit(repoPath, args);
		}, "Error checking out branch"),
	);

	registerTool(
		"git_add",
		{
			description: "Stage files for commit",
			inputSchema: {
				repoPath: z
					.string()
					.describe("Absolute path to the git repository root"),
				all: z.boolean().optional().describe("Stage all changes"),
				paths: z
					.array(z.string())
					.optional()
					.describe("Specific paths to stage"),
			},
		},
		createSafeHandler(async (rawArgs) => {
			const { repoPath, all, paths } = rawArgs as unknown as {
				repoPath: string;
				all?: boolean;
				paths?: string[];
			};
			if (!all && (!paths || paths.length === 0)) {
				return errorResponse(
					"Error staging files: paths is required when all is false.",
				);
			}
			const args = ["add"];
			if (all) {
				args.push("-A");
			} else if (paths?.length !== undefined) {
				args.push("--", ...paths);
			}
			return await runGit(repoPath, args);
		}, "Error staging files"),
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
		createSafeHandler(async (rawArgs) => {
			const { repoPath, message, all } = rawArgs as unknown as {
				repoPath: string;
				message: string;
				all?: boolean;
			};
			if (!message.trim()) {
				return errorResponse(
					"Error creating commit: message must be non-empty.",
				);
			}
			const args = ["commit"];
			if (all) args.push("-a");
			args.push("-m", message);
			return await runGit(repoPath, args);
		}, "Error creating commit"),
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
		createSafeHandler(async (rawArgs) => {
			const { repoPath, revision, stat } = rawArgs as unknown as {
				repoPath: string;
				revision?: string;
				stat?: boolean;
			};
			const args = ["show"];
			if (stat) args.push("--stat");
			if (revision) args.push(revision);
			return await runGit(repoPath, args);
		}, "Error showing revision"),
	);
}
