import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import * as path from "node:path";
import { promisify } from "node:util";
import { McpTool } from "@agent-manager/shared";
import { splitCommand } from "../../agents/drivers/interface";
import { InternalToolProvider } from "../types";

const execFileAsync = promisify(execFile);

type CommandParts = {
    command: string;
    args: string[];
};

type ConflictCheckResult = {
    status: "ok" | "skipped" | "error";
    output: string;
};

function buildCommandParts(command: string, args?: string[]): CommandParts {
    const parsed = splitCommand(command);
    if (!parsed.command) {
        throw new Error("command must be a non-empty string.");
    }
    if (args && args.length > 0) {
        return { command: parsed.command, args: [...parsed.args, ...args] };
    }
    return { command: parsed.command, args: parsed.args };
}

async function runCommand(cwd: string, command: string, args: string[]) {
    const { stdout, stderr } = await execFileAsync(command, args, { cwd });
    const out = stdout?.toString().trim();
    const err = stderr?.toString().trim();
    if (out && err) return `${out}\n${err}`;
    if (out) return out;
    if (err) return err;
    return "";
}

async function runGit(cwd: string, args: string[]) {
    return runCommand(cwd, "git", args);
}

function findDepCruiseBin(repoPath: string): string | null {
    const binName = process.platform === "win32" ? "depcruise.cmd" : "depcruise";
    const localBin = path.join(repoPath, "node_modules", ".bin", binName);
    if (existsSync(localBin)) {
        return localBin;
    }
    return null;
}

async function runConflictCheck(
    repoPath: string,
    configPath?: string,
    paths?: string[],
    extraArgs?: string[]
): Promise<ConflictCheckResult> {
    const depCruiseBin = findDepCruiseBin(repoPath);
    if (!depCruiseBin) {
        return {
            status: "skipped",
            output: "dependency-cruiser not installed (node_modules/.bin/depcruise not found)."
        };
    }

    try {
        const args: string[] = [];
        if (configPath) {
            args.push("--config", configPath);
        }
        if (extraArgs && extraArgs.length > 0) {
            args.push(...extraArgs);
        }
        const targets = paths && paths.length > 0 ? paths : ["."];
        args.push(...targets);
        const output = await runCommand(repoPath, depCruiseBin, args);
        return { status: "ok", output };
    } catch (error) {
        return {
            status: "error",
            output: error instanceof Error ? error.message : String(error)
        };
    }
}

function buildAutoCommitMessage(files: string[]): string {
    if (files.length === 1) {
        const fileName = files[0].split(/[\\/]/).pop() || files[0];
        return `chore: update ${fileName}`;
    }
    if (files.length > 1) {
        return `chore: update ${files.length} files`;
    }
    return `chore: micro-commit ${new Date().toISOString()}`;
}

export class CommitSyncProvider implements InternalToolProvider {
    async listTools(): Promise<McpTool[]> {
        return [
            {
                name: "commit_and_sync",
                description: "Run a quick check, commit staged changes, and run a conflict check",
                inputSchema: {
                    type: "object",
                    properties: {
                        repoPath: { type: "string", description: "Absolute path to the git repository root" },
                        message: { type: "string", description: "Commit message (auto-generated if omitted)" },
                        files: { type: "array", items: { type: "string" }, description: "Files to stage (default: stage all)" },
                        checkCommand: { type: "string", description: "Optional command to run before commit (default: git diff --check --cached)" },
                        checkArgs: { type: "array", items: { type: "string" }, description: "Extra args for checkCommand" },
                        allowEmpty: { type: "boolean", description: "Allow empty commit" },
                        push: { type: "boolean", description: "Push after commit" },
                        remote: { type: "string", description: "Remote to push to (default: origin)" },
                        branch: { type: "string", description: "Branch to push (default: current branch)" },
                        conflictPaths: { type: "array", items: { type: "string" }, description: "Paths for dependency-cruiser conflict check" },
                        conflictArgs: { type: "array", items: { type: "string" }, description: "Extra args for dependency-cruiser" },
                        conflictConfig: { type: "string", description: "Dependency-cruiser config file path" }
                    },
                    required: ["repoPath"]
                },
                serverName: "agents-manager-mcp"
            },
            {
                name: "auto_rebase",
                description: "Auto rebase the current branch onto its upstream or specified base",
                inputSchema: {
                    type: "object",
                    properties: {
                        repoPath: { type: "string", description: "Absolute path to the git repository root" },
                        upstream: { type: "string", description: "Upstream branch (defaults to tracking branch)" },
                        fetch: { type: "boolean", description: "Run git fetch before rebase (default: true)" }
                    },
                    required: ["repoPath"]
                },
                serverName: "agents-manager-mcp"
            },
            {
                name: "check_conflicts",
                description: "Run dependency-cruiser to detect dependency conflicts",
                inputSchema: {
                    type: "object",
                    properties: {
                        repoPath: { type: "string", description: "Absolute path to the git repository root" },
                        configPath: { type: "string", description: "dependency-cruiser config file path" },
                        paths: { type: "array", items: { type: "string" }, description: "Paths to analyze" },
                        extraArgs: { type: "array", items: { type: "string" }, description: "Extra args to pass to dependency-cruiser" }
                    },
                    required: ["repoPath"]
                },
                serverName: "agents-manager-mcp"
            }
        ];
    }

    async callTool(name: string, args: any): Promise<any> {
        if (!args || typeof args.repoPath !== "string") {
            throw new Error("repoPath is required.");
        }

        switch (name) {
            case "commit_and_sync": {
                const repoPath = args.repoPath as string;
                const files = Array.isArray(args.files) ? args.files : [];
                const allowEmpty = Boolean(args.allowEmpty);

                if (files.length > 0) {
                    await runGit(repoPath, ["add", "--", ...files]);
                } else {
                    await runGit(repoPath, ["add", "-A"]);
                }

                const stagedFilesRaw = await runGit(repoPath, ["diff", "--cached", "--name-only"]);
                const stagedFiles = stagedFilesRaw
                    .split("\n")
                    .map((line) => line.trim())
                    .filter(Boolean);
                if (stagedFiles.length === 0 && !allowEmpty) {
                    throw new Error("No staged changes to commit.");
                }

                let checkOutput = "";
                if (typeof args.checkCommand === "string" && args.checkCommand.trim().length > 0) {
                    const check = buildCommandParts(args.checkCommand, args.checkArgs);
                    checkOutput = await runCommand(repoPath, check.command, check.args);
                } else {
                    checkOutput = await runGit(repoPath, ["diff", "--check", "--cached"]);
                }

                const message = typeof args.message === "string" && args.message.trim().length > 0
                    ? args.message
                    : buildAutoCommitMessage(stagedFiles);

                const commitArgs = ["commit", "-m", message];
                if (allowEmpty) {
                    commitArgs.push("--allow-empty");
                }
                await runGit(repoPath, commitArgs);

                const commitSha = await runGit(repoPath, ["rev-parse", "HEAD"]);

                const conflictResult = await runConflictCheck(
                    repoPath,
                    args.conflictConfig,
                    args.conflictPaths,
                    args.conflictArgs
                );

                let pushOutput: string | undefined;
                if (args.push) {
                    const remote = args.remote || "origin";
                    const branch = args.branch || (await runGit(repoPath, ["rev-parse", "--abbrev-ref", "HEAD"]));
                    pushOutput = await runGit(repoPath, ["push", remote, branch]);
                }

                return {
                    status: "ok",
                    commitSha: commitSha.trim(),
                    message,
                    stagedFiles,
                    checkOutput,
                    conflictResult,
                    pushOutput
                };
            }
            case "auto_rebase": {
                const repoPath = args.repoPath as string;
                const fetch = args.fetch !== false;
                if (fetch) {
                    await runGit(repoPath, ["fetch", "--all", "--prune"]);
                }
                let upstream = args.upstream as string | undefined;
                if (!upstream) {
                    try {
                        upstream = await runGit(repoPath, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"]);
                    } catch {
                        throw new Error("No upstream configured. Provide upstream parameter.");
                    }
                }
                const output = await runGit(repoPath, ["rebase", upstream.trim()]);
                return { status: "ok", output };
            }
            case "check_conflicts": {
                const result = await runConflictCheck(
                    args.repoPath,
                    args.configPath,
                    args.paths,
                    args.extraArgs
                );
                return result;
            }
            default:
                throw new Error(`Unknown tool: ${name}`);
        }
    }
}
