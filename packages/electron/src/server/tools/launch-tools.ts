import type { AutoConfig } from "@agent-manager/shared";
import { getStoreOrThrow } from "@agent-manager/shared";
import { spawn } from "node:child_process";
import { shell } from "electron";
import { z } from "zod";
import { splitCommand } from "../../agents/drivers/interface";
import { allocatePorts } from "../utils/port-utils";
import type { ToolRegistrar, ToolResult } from "./types";

interface RunningProcess {
    pid: number;
    command: string;
    projectId: string;
    ports: Record<string, number>;
    startedAt: number;
}

// Track running processes
const runningProcesses = new Map<string, RunningProcess>();

export function registerLaunchTools(registerTool: ToolRegistrar) {
    registerTool(
        "launch_project",
        {
            description: `Launch the project's development server based on its Auto Configuration.
This tool will:
1. Read the project's AutoConfig settings
2. Automatically allocate available ports (avoiding conflicts)
3. Run the startup command with the allocated ports as environment variables
4. Wait for the readiness pattern to appear in logs
5. Open browser (for 'web' type) or notify completion (for 'other' type)

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

            // Get project and its AutoConfig
            const store = getStoreOrThrow();
            const project = store.getProject(projectId);

            if (!project) {
                return {
                    content: [{ type: "text", text: `Error: Project ${projectId} not found` }],
                    isError: true,
                };
            }

            if (!project.autoConfig) {
                return {
                    content: [
                        {
                            type: "text",
                            text: `Error: Project "${project.name}" does not have Auto Configuration set up. 
Please configure it in Project Settings > Auto Configuration.`,
                        },
                    ],
                    isError: true,
                };
            }

            if (!project.rootPath) {
                return {
                    content: [{ type: "text", text: `Error: Project "${project.name}" does not have a root path set` }],
                    isError: true,
                };
            }

            const config: AutoConfig = project.autoConfig;

            // Check if already running
            if (runningProcesses.has(projectId)) {
                const running = runningProcesses.get(projectId);
                if (running) {
                    return {
                        content: [
                            {
                                type: "text",
                                text: `Project "${project.name}" is already running (PID: ${running.pid})
Command: ${running.command}
Ports: ${JSON.stringify(running.ports)}
Started at: ${new Date(running.startedAt).toISOString()}`,
                            },
                        ],
                    };
                }
            }

            try {
                // Allocate ports
                console.log(`[McpServer] Allocating ports for config:`, config.ports);
                const allocatedPorts = await allocatePorts(config.ports);
                console.log(`[McpServer] Allocated ports:`, allocatedPorts);

                // Prepare environment variables
                const env: NodeJS.ProcessEnv = {
                    ...process.env,
                };
                for (const [envVar, port] of Object.entries(allocatedPorts)) {
                    env[envVar] = String(port);
                }

                // Parse and run command
                const { command, args } = splitCommand(config.command);
                if (!command) {
                    return {
                        content: [{ type: "text", text: `Error: Invalid command: "${config.command}"` }],
                        isError: true,
                    };
                }

                console.log(`[McpServer] Spawning: ${command} ${args.join(" ")} in ${project.rootPath}`);

                const childProcess = spawn(command, args, {
                    cwd: project.rootPath,
                    env,
                    shell: true,
                    stdio: ["ignore", "pipe", "pipe"],
                    detached: false,
                });

                if (!childProcess.pid) {
                    return {
                        content: [{ type: "text", text: `Error: Failed to spawn process for command: ${config.command}` }],
                        isError: true,
                    };
                }

                // Track the process
                runningProcesses.set(projectId, {
                    pid: childProcess.pid,
                    command: config.command,
                    projectId,
                    ports: allocatedPorts,
                    startedAt: Date.now(),
                });

                // Wait for readiness pattern
                const readinessPromise = new Promise<{ ready: boolean; logs: string }>((resolve) => {
                    const logs: string[] = [];
                    const pattern = new RegExp(config.readiness.logPattern);
                    let resolved = false;

                    const checkOutput = (data: Buffer) => {
                        const text = data.toString();
                        logs.push(text);
                        console.log(`[launch_project] stdout: ${text}`);

                        if (!resolved && pattern.test(text)) {
                            resolved = true;
                            resolve({ ready: true, logs: logs.join("") });
                        }
                    };

                    childProcess.stdout?.on("data", checkOutput);
                    childProcess.stderr?.on("data", (data) => {
                        const text = data.toString();
                        logs.push(text);
                        console.log(`[launch_project] stderr: ${text}`);

                        if (!resolved && pattern.test(text)) {
                            resolved = true;
                            resolve({ ready: true, logs: logs.join("") });
                        }
                    });

                    childProcess.on("error", (error) => {
                        if (!resolved) {
                            resolved = true;
                            resolve({ ready: false, logs: `Error: ${error.message}\n${logs.join("")}` });
                        }
                    });

                    childProcess.on("exit", (code) => {
                        if (!resolved) {
                            resolved = true;
                            resolve({
                                ready: false,
                                logs: `Process exited with code ${code}\n${logs.join("")}`,
                            });
                        }
                    });

                    // Timeout
                    setTimeout(() => {
                        if (!resolved) {
                            resolved = true;
                            resolve({
                                ready: false,
                                logs: `Timeout waiting for readiness pattern "${config.readiness.logPattern}"\n${logs.join("")}`,
                            });
                        }
                    }, timeout);
                });

                const result = await readinessPromise;

                if (!result.ready) {
                    // Clean up on failure
                    runningProcesses.delete(projectId);
                    try {
                        childProcess.kill();
                    } catch {
                        // Ignore kill errors
                    }

                    return {
                        content: [
                            {
                                type: "text",
                                text: `Failed to start project "${project.name}":
${result.logs}`,
                            },
                        ],
                        isError: true,
                    };
                }

                // Success! Handle based on type
                let actionMessage = "";

                				if (config.type === "web") {
                					// Find the main port (first one or PORT if exists)
                					const mainPort = allocatedPorts.PORT ?? Object.values(allocatedPorts)[0];
                					if (mainPort) {
                						const url = `http://localhost:${mainPort}`;
                						await shell.openExternal(url);                        actionMessage = `Opened browser at ${url}`;
                    } else {
                        actionMessage = "No port to open browser (ports config is empty)";
                    }
                } else {
                    actionMessage = "Application launched (non-web type - window should appear automatically)";
                }

                const portsSummary = Object.entries(allocatedPorts)
                    .map(([envVar, port]) => `  ${envVar}=${port}`)
                    .join("\n");

                return {
                    content: [
                        {
                            type: "text",
                            text: `✅ Project "${project.name}" started successfully!

Type: ${config.type}
Command: ${config.command}
PID: ${childProcess.pid}

Allocated Ports:
${portsSummary || "  (none)"}

${actionMessage}

Readiness detected: "${config.readiness.logPattern}"`,
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
            description: `Set or update the Auto Configuration for a project. 
This configuration determines how the project is launched and monitored using 'launch_project'.
Analyze the project structure (package.json, etc.) and call this tool with the appropriate settings.`,
            inputSchema: {
                projectId: z
                    .string()
                    .describe("The project ID to configure"),
                config: z.object({
                    type: z.enum(["web", "other"]).describe("Application type"),
                    command: z.string().describe("Startup command (e.g. 'pnpm run dev')"),
                    ports: z.record(z.string(), z.number()).describe("Map of environment variable names to default ports"),
                    readiness: z.object({
                        logPattern: z.string().describe("Regex to detect when server is ready"),
                    }),
                }),
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
Command: ${config.command}
Ports: ${JSON.stringify(config.ports)}
Readiness: "${config.readiness.logPattern}"

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
            const running = runningProcesses.get(projectId);

            if (!running) {
                return {
                    content: [
                        { type: "text", text: `No running process found for project ${projectId}` },
                    ],
                };
            }

            try {
                process.kill(running.pid, "SIGTERM");
                runningProcesses.delete(projectId);

                return {
                    content: [
                        {
                            type: "text",
                            text: `Stopped project (PID: ${running.pid})
Command was: ${running.command}`,
                        },
                    ],
                };
            } catch (error) {
                runningProcesses.delete(projectId);
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
            if (runningProcesses.size === 0) {
                return {
                    content: [{ type: "text", text: "No projects are currently running." }],
                };
            }

            const lines: string[] = [];
            for (const [projectId, info] of runningProcesses) {
                const store = getStoreOrThrow();
                const project = store.getProject(projectId);
                lines.push(`Project: ${project?.name ?? projectId}
  PID: ${info.pid}
  Command: ${info.command}
  Ports: ${JSON.stringify(info.ports)}
  Started: ${new Date(info.startedAt).toISOString()}
`);
            }

            return {
                content: [{ type: "text", text: lines.join("\n") }],
            };
        },
    );
}
