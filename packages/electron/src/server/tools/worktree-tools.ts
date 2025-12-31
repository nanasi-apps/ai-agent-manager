import { existsSync } from "fs";
import * as fs from "fs/promises";
import * as path from "path";
import { z } from "zod";
import { getStoreOrThrow } from "@agent-manager/shared";
import { getAgentManager } from "../../agents/agent-manager";
import {
    buildConflictResolutionMessage,
    buildWorktreeCreateResultMessage,
} from "../../agents/context-builder";
import { splitCommand } from "../../agents/drivers/interface";
import { worktreeManager } from "../../main/worktree-manager";
import {
    execFileAsync,
    getCurrentBranch,
    getConflictedFiles,
    runGtr,
} from "../utils";
import type { ToolRegistrar } from "./types";

export function registerWorktreeTools(registerTool: ToolRegistrar) {
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
}
