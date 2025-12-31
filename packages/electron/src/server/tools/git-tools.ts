import { z } from "zod";
import { runGit, getCurrentBranch } from "../utils";
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
}
