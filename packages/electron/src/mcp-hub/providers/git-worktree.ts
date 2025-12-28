import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { McpTool } from "@agent-manager/shared";
import { splitCommand } from "../../agents/drivers/interface";
import { InternalToolProvider } from "../types";

const execFileAsync = promisify(execFile);

type WorktreeRunArgs = {
    repoPath: string;
    branch: string;
    command: string | string[];
    args?: string[];
};

function formatOutput(stdout?: string, stderr?: string, emptyFallback = "OK") {
    const cleanStdout = stdout?.trim();
    const cleanStderr = stderr?.trim();
    if (cleanStdout && cleanStderr) {
        return `${cleanStdout}\n${cleanStderr}`;
    }
    if (cleanStdout) return cleanStdout;
    if (cleanStderr) return cleanStderr;
    return emptyFallback;
}

function extractErrorMessage(error: unknown) {
    if (error instanceof Error) {
        return error.message;
    }
    return String(error);
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
        const message = formatOutput(stdout, stderr, "") || extractErrorMessage(error);
        if (message.includes("is not a git command")) {
            throw new Error("git gtr is not installed. Install git-worktree-runner (https://github.com/coderabbitai/git-worktree-runner).");
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
                description: "Create a worktree using git-worktree-runner (git gtr new <branch>)",
                inputSchema: {
                    type: "object",
                    properties: {
                        repoPath: { type: "string", description: "Absolute path to the git repository root" },
                        branch: { type: "string", description: "Branch name to create or checkout" },
                    },
                    required: ["repoPath", "branch"],
                },
                serverName: "agents-manager-mcp",
            },
            {
                name: "worktree_list",
                description: "List worktrees using git-worktree-runner (git gtr list --porcelain)",
                inputSchema: {
                    type: "object",
                    properties: {
                        repoPath: { type: "string", description: "Absolute path to the git repository root" },
                    },
                    required: ["repoPath"],
                },
                serverName: "agents-manager-mcp",
            },
            {
                name: "worktree_remove",
                description: "Remove a worktree using git-worktree-runner (git gtr rm <branch>)",
                inputSchema: {
                    type: "object",
                    properties: {
                        repoPath: { type: "string", description: "Absolute path to the git repository root" },
                        branch: { type: "string", description: "Branch name to remove" },
                    },
                    required: ["repoPath", "branch"],
                },
                serverName: "agents-manager-mcp",
            },
            {
                name: "worktree_run",
                description: "Run a command in a worktree using git-worktree-runner (git gtr run <branch> <cmd>)",
                inputSchema: {
                    type: "object",
                    properties: {
                        repoPath: { type: "string", description: "Absolute path to the git repository root" },
                        branch: { type: "string", description: "Branch name to run the command in" },
                        command: { type: "string", description: "Command to run (e.g. \"pnpm test\")" },
                        args: { type: "array", items: { type: "string" }, description: "Optional command arguments" },
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
                return await runGtr(args.repoPath, ["new", args.branch]);
            }
            case "worktree_list":
                return await runGtr(args.repoPath, ["list", "--porcelain"]);
            case "worktree_remove": {
                if (!args.branch) {
                    throw new Error("branch is required.");
                }
                return await runGtr(args.repoPath, ["rm", args.branch]);
            }
            case "worktree_run": {
                const runArgs = args as WorktreeRunArgs;
                if (!runArgs.branch) {
                    throw new Error("branch is required.");
                }
                const commandParts = buildRunCommand(runArgs);
                return await runGtr(runArgs.repoPath, ["run", runArgs.branch, ...commandParts]);
            }
            default:
                throw new Error(`Unknown tool: ${name}`);
        }
    }
}
