import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPTransport } from "@hono/mcp";
import { execFile } from "node:child_process";
import * as fs from "fs/promises";
import * as path from "path";
import { promisify } from "node:util";
import { z } from "zod";
import { splitCommand } from "../agents/drivers/interface";
import { getAgentManager } from "../agents/agent-manager";
import { worktreeManager } from "../main/worktree-manager";

export async function startMcpServer(port: number = 3001) {
    const server = new McpServer({
        name: "agent-manager",
        version: "1.0.0"
    });

    const execFileAsync = promisify(execFile);

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
                throw new Error("git gtr is not installed. Install git-worktree-runner (https://github.com/coderabbitai/git-worktree-runner).");
            }
            throw new Error(message);
        }
    };

    // Register FS tools
    server.tool(
        "read_file",
        {
            path: z.string().describe("Absolute path to the file"),
        },
        async ({ path: filePath }) => {
            try {
                const content = await fs.readFile(filePath, "utf-8");
                return {
                    content: [{ type: "text", text: content }],
                };
            } catch (error: any) {
                return {
                    content: [{ type: "text", text: `Error reading file: ${error.message}` }],
                    isError: true,
                };
            }
        }
    );

    server.tool(
        "write_file",
        {
            path: z.string().describe("Absolute path to the file"),
            content: z.string().describe("Content to write"),
        },
        async ({ path: filePath, content }) => {
            try {
                await fs.mkdir(path.dirname(filePath), { recursive: true });
                await fs.writeFile(filePath, content, "utf-8");
                return {
                    content: [{ type: "text", text: `Successfully wrote to ${filePath}` }],
                };
            } catch (error: any) {
                return {
                    content: [{ type: "text", text: `Error writing file: ${error.message}` }],
                    isError: true,
                };
            }
        }
    );

    server.tool(
        "replace_file_content",
        {
            path: z.string().describe("Absolute path to the file"),
            target: z.string().describe("String to replace"),
            replacement: z.string().describe("New string"),
        },
        async ({ path: filePath, target, replacement }) => {
            try {
                const content = await fs.readFile(filePath, "utf-8");
                if (!content.includes(target)) {
                    return {
                        content: [{ type: "text", text: `Target string not found in file: ${filePath}` }],
                        isError: true
                    };
                }
                const newContent = content.replace(target, replacement);
                await fs.writeFile(filePath, newContent, "utf-8");
                return {
                    content: [{ type: "text", text: `Successfully replaced content in ${filePath}` }],
                };
            } catch (error: any) {
                return {
                    content: [{ type: "text", text: `Error replacing content: ${error.message}` }],
                    isError: true,
                };
            }
        }
    );

    server.tool(
        "pre_file_edit",
        {
            path: z.string().describe("Absolute path to the file"),
            operation: z.string().describe("Operation name (write_file, replace_file_content, etc.)"),
            editId: z.string().optional().describe("Optional identifier to correlate with post_file_edit"),
        },
        async ({ path: filePath, operation }) => {
            return {
                content: [{ type: "text", text: `Pre-edit recorded for ${filePath} (${operation})` }],
            };
        }
    );

    server.tool(
        "post_file_edit",
        {
            path: z.string().describe("Absolute path to the file"),
            operation: z.string().describe("Operation name (write_file, replace_file_content, etc.)"),
            editId: z.string().optional().describe("Optional identifier to correlate with pre_file_edit"),
            success: z.boolean().optional().describe("Whether the operation succeeded"),
            message: z.string().optional().describe("Optional message about the operation outcome"),
        },
        async ({ path: filePath, operation, success, message }) => {
            const status = success === false ? "failed" : "completed";
            const suffix = message ? `: ${message}` : "";
            return {
                content: [{ type: "text", text: `Post-edit ${status} for ${filePath} (${operation})${suffix}` }],
            };
        }
    );

    server.tool(
        "worktree_create",
        {
            repoPath: z.string().describe("Absolute path to the git repository root"),
            branch: z.string().describe("Branch name to create or checkout"),
            sessionId: z.string().optional().describe("Optional agent session ID to resume in the worktree"),
            resume: z.boolean().optional().describe("Schedule a resume in the created worktree"),
            resumeMessage: z.string().optional().describe("Optional message to send on resume"),
        },
        async ({ repoPath, branch, sessionId, resume, resumeMessage }) => {
            const normalizedBranch = branch.replace(/^refs\/heads\//, "");
            let createOutput = "";
            let createError: string | null = null;

            try {
                console.log(`[McpServer] Creating worktree for branch ${normalizedBranch} in ${repoPath}`);
                createOutput = await runGtr(repoPath, ["new", normalizedBranch]);
                console.log(`[McpServer] Create output: ${createOutput}`);
            } catch (error: any) {
                createError = error?.message || String(error);
                createOutput = `Error creating worktree: ${createError}`;
                console.error(`[McpServer] Create error: ${createError}`);
            }

            const resumeRequested = resume ?? Boolean(sessionId);
            let worktreePath: string | undefined;
            let resumeError: string | null = null;
            let resumeScheduled = false;

            if (resumeRequested) {
                try {
                    console.log(`[McpServer] Locating worktree for branch ${normalizedBranch}`);
                    const worktrees = await worktreeManager.getWorktrees(repoPath);
                    console.log(`[McpServer] Available worktrees: ${worktrees.map(wt => `${wt.branch}:${wt.path}`).join(', ')}`);
                    // Filter out prunable worktrees (directories that might have been deleted)
                    worktreePath = worktrees.find((wt) => wt.branch === normalizedBranch && !wt.prunable)?.path;
                    
                    if (worktreePath) {
                        try {
                            await fs.access(worktreePath);
                            console.log(`[McpServer] Found and verified worktree path: ${worktreePath}`);
                        } catch {
                            // If we can't access it, assume it's invalid
                            resumeError = resumeError || `Worktree path ${worktreePath} is not accessible.`;
                            console.warn(`[McpServer] Worktree path ${worktreePath} is not accessible.`);
                            worktreePath = undefined;
                        }
                    } else {
                        console.warn(`[McpServer] Worktree for branch ${normalizedBranch} not found in list.`);
                    }
                } catch (error: any) {
                    resumeError = error?.message || String(error);
                    console.error(`[McpServer] Error locating worktree: ${resumeError}`);
                }

                if (!sessionId) {
                    resumeError = resumeError || "sessionId is required to schedule resume.";
                } else if (!worktreePath) {
                    resumeError = resumeError || `Unable to locate worktree path for branch ${normalizedBranch}.`;
                } else {
                    try {
                        const manager = getAgentManager();
                        console.log(`[McpServer] Requesting worktree resume for session ${sessionId} in ${worktreePath}`);
                        if (typeof manager.requestWorktreeResume !== "function") {
                            resumeError = "Active agent manager does not support worktree resume.";
                        } else {
                            resumeScheduled = manager.requestWorktreeResume(sessionId, {
                                cwd: worktreePath,
                                branch: normalizedBranch,
                                repoPath,
                                resumeMessage,
                            });
                            if (!resumeScheduled) {
                                resumeError = "Failed to schedule worktree resume.";
                            }
                        }
                    } catch (error: any) {
                        resumeError = error?.message || String(error);
                        console.error(`[McpServer] Error scheduling resume: ${resumeError}`);
                    }
                }
            }

            const lines: string[] = [];
            if (createOutput) lines.push(createOutput);
            if (worktreePath) lines.push(`Worktree path: ${worktreePath}`);
            if (resumeScheduled) lines.push("Resume scheduled.");
            if (resumeError) lines.push(`Resume not scheduled: ${resumeError}`);

            const isError = Boolean((createError && !worktreePath) || (resumeRequested && resumeError));
            return {
                content: [{ type: "text", text: lines.join("\n") || "OK" }],
                isError: isError || undefined,
            };
        }
    );

    server.tool(
        "worktree_list",
        {
            repoPath: z.string().describe("Absolute path to the git repository root"),
        },
        async ({ repoPath }) => {
            try {
                const result = await runGtr(repoPath, ["list", "--porcelain"]);
                return {
                    content: [{ type: "text", text: result }],
                };
            } catch (error: any) {
                return {
                    content: [{ type: "text", text: `Error listing worktrees: ${error.message}` }],
                    isError: true,
                };
            }
        }
    );

    server.tool(
        "worktree_remove",
        {
            repoPath: z.string().describe("Absolute path to the git repository root"),
            branch: z.string().describe("Branch name to remove"),
        },
        async ({ repoPath, branch }) => {
            try {
                const result = await runGtr(repoPath, ["rm", branch]);
                return {
                    content: [{ type: "text", text: result }],
                };
            } catch (error: any) {
                return {
                    content: [{ type: "text", text: `Error removing worktree: ${error.message}` }],
                    isError: true,
                };
            }
        }
    );

    server.tool(
        "worktree_complete",
        {
            repoPath: z.string().describe("Absolute path to the git repository root"),
            branch: z.string().describe("Branch name to merge and remove"),
        },
        async ({ repoPath, branch }) => {
            try {
                // 1. Merge
                await execFileAsync("git", ["merge", "--no-ff", branch], {
                    cwd: repoPath,
                });

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
                    content: [{ type: "text", text: `Error completing worktree: ${msg}` }],
                    isError: true,
                };
            }
        }
    );

    server.tool(
        "worktree_run",
        {
            repoPath: z.string().describe("Absolute path to the git repository root"),
            branch: z.string().describe("Branch name to run the command in"),
            command: z.string().describe("Command to run (e.g. \"pnpm test\")"),
            args: z.array(z.string()).optional().describe("Optional command arguments"),
        },
        async ({ repoPath, branch, command, args }) => {
            try {
                const commandParts = args && args.length > 0
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
                    content: [{ type: "text", text: `Error running worktree command: ${error.message}` }],
                    isError: true,
                };
            }
        }
    );

    server.tool(
        "list_directory",
        {
            path: z.string().describe("Absolute path to the directory"),
        },
        async ({ path: dirPath }) => {
            try {
                const files = await fs.readdir(dirPath);
                return {
                    content: [{ type: "text", text: JSON.stringify(files, null, 2) }],
                };
            } catch (error: any) {
                return {
                    content: [{ type: "text", text: `Error listing directory: ${error.message}` }],
                    isError: true,
                };
            }
        }
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
        port
    });

    return app;
}