import { AgentConfigSchema, getStoreOrThrow } from "@agent-manager/shared";
import { z } from "zod";
import { getAgentManager } from "../../agents/agent-manager";
import { devServerManager } from "../../main/dev-server-manager";
import { getSessionContext } from "../mcp-session-context";
import type { ToolRegistrar, ToolResult } from "./types";

export function registerLaunchTools(registerTool: ToolRegistrar) {
    registerTool(
        "launch_project",
        {
            description: `Launch the project's development server based on its Agent Configuration.
This tool will:
1. Read the project's AgentConfig settings
2. Automatically allocate available ports based on 'services' definition
3. Run the startup command with the allocated ports injected as environment variables
4. Wait for readiness (if configured)
5. Perform post-launch actions (e.g. open browser)

If a git worktree is active for the current session, the server will be launched in the worktree directory.

Use this when implementation is complete and you want to start the development server.`,
            inputSchema: {
                projectId: z
                    .string()
                    .describe("The project ID to launch"),
                timeout: z
                    .number()
                    .optional()
                    .describe("Timeout in milliseconds to wait for readiness (default: 60000)"),
            },
        },
        async ({ projectId, timeout = 60000 }): Promise<ToolResult> => {
            console.log(`[McpServer] launch_project called: projectId=${projectId}`);

            try {
                // Check if there's an active worktree for this session
                const context = getSessionContext();
                let worktreeCwd: string | undefined;

                console.log(`[McpServer] launch_project: sessionContext=${JSON.stringify(context)}`);

                if (context?.sessionId) {
                    const manager = getAgentManager();
                    worktreeCwd = manager.getSessionCwd?.(context.sessionId);
                    console.log(`[McpServer] launch_project: getSessionCwd(${context.sessionId}) = ${worktreeCwd ?? "undefined"}`);
                    if (worktreeCwd) {
                        console.log(`[McpServer] Using worktree path: ${worktreeCwd}`);
                    } else {
                        console.log(`[McpServer] No worktree path found for session ${context.sessionId}`);
                    }
                } else {
                    console.log(`[McpServer] No session context available`);
                }

                const processInfo = await devServerManager.launchProject(projectId, {
                    timeout,
                    cwd: worktreeCwd,
                    conversationId: context?.sessionId,
                });
                const project = getStoreOrThrow().getProject(projectId);

                const portsSummary = Object.entries(processInfo.ports)
                    .map(([envVar, port]) => `  ${envVar}=${port}`)
                    .join("\n");

                let actionMessage = "";
                if (processInfo.url) {
                    actionMessage = `Opened browser at ${processInfo.url}`;
                } else {
                    actionMessage = `Application launched (Type: ${processInfo.type})`;
                }

                const cwdMessage = worktreeCwd
                    ? `Working Directory: ${worktreeCwd} (worktree)`
                    : `Working Directory: ${project?.rootPath ?? "unknown"}`;

                return {
                    content: [
                        {
                            type: "text",
                            text: `✅ Project "${project?.name ?? projectId}" started successfully!

Type: ${processInfo.type}
Command: ${processInfo.command}
PID: ${processInfo.pid}
${cwdMessage}

Allocated Ports:
${portsSummary || "  (none)"}

${actionMessage}`,
                        },
                    ],
                };
            } catch (error) {
                return {
                    content: [
                        {
                            type: "text",
                            text: `Error launching project: ${error instanceof Error ? error.message : String(error)}`,
                        },
                    ],
                    isError: true,
                };
            }
        },
    );

    registerTool(
        "project_set_auto_config",
        {
            description: `Set or update the Agent Configuration for a project (agent.config.json equivalent). 
This configuration determines how the project is launched and managed.
Analyze the project structure (package.json, etc.) and call this tool with the appropriate settings.`,
            inputSchema: {
                projectId: z
                    .string()
                    .describe("The project ID to configure"),
                config: AgentConfigSchema,
            },
        },
        async ({ projectId, config }): Promise<ToolResult> => {
            const store = getStoreOrThrow();
            const project = store.getProject(projectId);

            if (!project) {
                return {
                    content: [{ type: "text", text: `Error: Project ${projectId} not found` }],
                    isError: true,
                };
            }

            try {
                store.updateProject(projectId, { autoConfig: config });
                return {
                    content: [
                        {
                            type: "text",
                            text: `✅ Auto Configuration updated for project "${project.name}"

Type: ${config.type}
Command: ${config.startCommand}
Services: ${config.services?.length ? config.services.map((s: any) => `${s.name} (${s.default}${s.argument ? `, ${s.argument}` : ""})`).join(", ") : "(none)"}

You can now use 'launch_project' to start this application.`,
                        },
                    ],
                };
            } catch (error) {
                return {
                    content: [
                        {
                            type: "text",
                            text: `Error updating Auto Config: ${error instanceof Error ? error.message : String(error)}`,
                        },
                    ],
                    isError: true,
                };
            }
        },
    );

    registerTool(
        "stop_project",
        {
            description: "Stop a running project that was launched with launch_project",
            inputSchema: {
                projectId: z.string().describe("The project ID to stop"),
            },
        },
        async ({ projectId }): Promise<ToolResult> => {
            try {
                const context = getSessionContext();
                const stopped = await devServerManager.stopProject(projectId, context?.sessionId);
                if (stopped) {
                    return {
                        content: [{ type: "text", text: `Stopped project ${projectId}` }],
                    };
                } else {
                    return {
                        content: [{ type: "text", text: `Project ${projectId} is not running` }],
                    };
                }
            } catch (error) {
                return {
                    content: [
                        {
                            type: "text",
                            text: `Error stopping process: ${error instanceof Error ? error.message : String(error)}`,
                        },
                    ],
                    isError: true,
                };
            }
        },
    );

    registerTool(
        "list_running_projects",
        {
            description: "List all currently running projects launched via launch_project",
            inputSchema: {},
        },
        async (): Promise<ToolResult> => {
            const processes = devServerManager.listRunningProjects();
            if (processes.length === 0) {
                return {
                    content: [{ type: "text", text: "No projects are currently running." }],
                };
            }

            const lines: string[] = [];
            for (const info of processes) {
                const store = getStoreOrThrow();
                const project = store.getProject(info.projectId);
                lines.push(`Project: ${project?.name ?? info.projectId}
  PID: ${info.pid}
  Command: ${info.command}
  Ports: ${JSON.stringify(info.ports)}
  Started: ${new Date(info.startedAt).toISOString()}
${info.conversationId ? `  Conversation: ${info.conversationId}\n` : ""}`);
            }

            return {
                content: [{ type: "text", text: lines.join("\n") }],
            };
        },
    );
}
