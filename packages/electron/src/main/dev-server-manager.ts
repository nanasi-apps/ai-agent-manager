import { spawn } from "node:child_process";
import { shell } from "electron";
import { getStoreOrThrow, type AutoConfig } from "@agent-manager/shared";
import { allocatePorts } from "../server/utils/port-utils";

export interface RunningProcess {
    pid: number;
    command: string;
    projectId: string;
    ports: Record<string, number>;
    startedAt: number;
    type: "web" | "process" | "other";
    url?: string;
    conversationId?: string;
}

class DevServerManager {
    private runningProcesses = new Map<string, RunningProcess>();

    private getProcessKey(projectId: string, conversationId?: string): string {
        return conversationId ? `${projectId}:${conversationId}` : projectId;
    }

    getRunningProject(projectId: string, conversationId?: string): RunningProcess | undefined {
        return this.runningProcesses.get(this.getProcessKey(projectId, conversationId));
    }

    listRunningProjects(): RunningProcess[] {
        return Array.from(this.runningProcesses.values());
    }

    async stopProject(projectId: string, conversationId?: string): Promise<boolean> {
        const key = this.getProcessKey(projectId, conversationId);
        const running = this.runningProcesses.get(key);
        if (!running) return false;

        try {
            // Clean up child process
            // If pid is negative, it kills the process group (requires detached: true)
            try {
                process.kill(-running.pid, "SIGTERM");
            } catch (e: any) {
                // ignore if already dead
                if (e.code !== 'ESRCH') {
                    console.log(`[DevServerManager] Failed to kill process group ${running.pid}:`, e);
                }
            }

            this.runningProcesses.delete(key);
            return true;
        } catch (error) {
            this.runningProcesses.delete(key);
            throw error;
        }
    }

    async launchProject(
        projectId: string,
        options: { timeout?: number; cwd?: string; conversationId?: string } = {},
    ): Promise<RunningProcess> {
        const { timeout = 60000, cwd: overrideCwd, conversationId } = options;
        console.log(`[DevServerManager] Launching project ${projectId}${conversationId ? ` (conversation: ${conversationId})` : ""}${overrideCwd ? ` in ${overrideCwd}` : ""}`);

        const key = this.getProcessKey(projectId, conversationId);
        const running = this.runningProcesses.get(key);
        if (running) {
            return running;
        }

        try {
            const store = getStoreOrThrow();
            const project = store.getProject(projectId);

            if (!project) throw new Error(`Project ${projectId} not found`);

            const config = project.autoConfig;

            if (!config) throw new Error(`Project "${project.name}" does not have Agent Configuration set up.`);
            if (!project.rootPath) throw new Error(`Project "${project.name}" does not have a root path set`);

            // Use worktree cwd if provided, otherwise use project root
            const workingDir = overrideCwd ?? project.rootPath;

            // 1. Allocate ports
            console.log(`[DevServerManager] Allocating ports for project ${projectId}`);
            const portRequests: Record<string, number> = {};

            if (config.services && config.services.length > 0) {
                for (const svc of config.services) {
                    portRequests[svc.envKey] = svc.default;
                }
            } else if ((config as any).ports) {
                // Backward compatibility for legacy config
                console.log("[DevServerManager] Using legacy 'ports' configuration");
                const legacyPorts = (config as any).ports as Record<string, number>;
                for (const [key, val] of Object.entries(legacyPorts)) {
                    portRequests[key] = val;
                }
            }

            const allocatedPorts = await allocatePorts(portRequests);
            console.log(`[DevServerManager] Allocated ports:`, allocatedPorts);

            // 2. Prepare environment variables and command prefix
            const env: NodeJS.ProcessEnv = {
                ...process.env,
            };
            let envPrefix = "";
            for (const [envVar, port] of Object.entries(allocatedPorts)) {
                env[envVar] = String(port);
                envPrefix += `${envVar}=${port} `;
            }

            // 3. Construct full command with CLI argument injection
            const cmd = config.startCommand || (config as any).command;
            if (!cmd) throw new Error("No start command defined in configuration");

            // Build CLI arguments from services that have 'argument' defined
            let cliArgs = "";
            if (config.services && config.services.length > 0) {
                for (const svc of config.services) {
                    if (svc.argument && allocatedPorts[svc.envKey]) {
                        cliArgs += ` ${svc.argument} ${allocatedPorts[svc.envKey]}`;
                    }
                }
            }

            // Combine: environment variables prefix + command + CLI arguments
            const fullCommand = `BROWSER=none ${envPrefix}${cmd}${cliArgs}`;

            console.log(`[DevServerManager] Spawning: ${fullCommand} in ${workingDir}`);

            const childProcess = spawn(fullCommand, {
                cwd: workingDir,
                env,
                shell: true,
                stdio: ["ignore", "pipe", "pipe"],
                detached: true,
            });

            if (!childProcess.pid) throw new Error(`Failed to spawn process for command: ${cmd}`);

            // Track process configuration
            const processInfo: RunningProcess = {
                pid: childProcess.pid,
                command: cmd,
                projectId,
                ports: allocatedPorts,
                startedAt: Date.now(),
                type: config.type as "web" | "process" | "other",
                url: undefined,
                conversationId,
            };
            this.runningProcesses.set(key, processInfo);

            // 4. Wait for readiness (if configured)
            const readinessConfig = config.readiness || (config as any).readiness;

            if (readinessConfig && readinessConfig.logPattern) {
                console.log(`[DevServerManager] Waiting for readiness: ${readinessConfig.logPattern}`);
                try {
                    const { ready, logs } = await this.waitForReadiness(childProcess, readinessConfig.logPattern, timeout);

                    if (!ready) {
                        throw new Error(`Readiness check failed:\n${logs}`);
                    }
                } catch (error) {
                    throw error;
                }
            }

            // 5. Post-Launch Action
            if (config.action) {
                if (config.action.type === 'open_browser') {
                    let targetPort: number | undefined;
                    if (config.action.targetService) {
                        const svc = config.services?.find(s => s.name === config.action!.targetService);
                        if (svc && allocatedPorts[svc.envKey]) {
                            targetPort = allocatedPorts[svc.envKey];
                        }
                    } else {
                        const firstKey = Object.keys(allocatedPorts)[0];
                        if (firstKey) targetPort = allocatedPorts[firstKey];
                    }

                    if (targetPort) {
                        const url = `http://localhost:${targetPort}`;
                        processInfo.url = url;
                        try {
                            await shell.openExternal(url);
                        } catch (e) {
                            console.error("Failed to open browser:", e);
                        }
                    }
                }
            } else {
                // Legacy fallback
                if (config.type === 'web') {
                    const mainPort = Object.values(allocatedPorts)[0];
                    if (mainPort) {
                        const url = `http://localhost:${mainPort}`;
                        processInfo.url = url;
                        try {
                            await shell.openExternal(url);
                        } catch (e) {
                            console.error("Failed to open browser:", e);
                        }
                    }
                }
            }

            return processInfo;

        } catch (error) {
            console.error(`[DevServerManager] Error launching project ${projectId}:`, error);
            // Cleanup on error
            await this.stopProject(projectId, conversationId).catch(() => { });
            throw error;
        }
    }

    private waitForReadiness(childProcess: any, logPattern: string, timeout: number): Promise<{ ready: boolean; logs: string }> {
        return new Promise((resolve) => {
            const logs: string[] = [];
            const pattern = new RegExp(logPattern);
            let resolved = false;

            const checkOutput = (data: Buffer) => {
                const text = data.toString();
                logs.push(text);
                process.stdout.write(`[Child stdout] ${text}`);
                if (!resolved && pattern.test(text)) {
                    resolved = true;
                    resolve({ ready: true, logs: logs.join("") });
                }
            };

            childProcess.stdout?.on("data", checkOutput);
            childProcess.stderr?.on("data", (data: any) => {
                const text = data.toString();
                logs.push(text);
                process.stderr.write(`[Child stderr] ${text}`);
                if (!resolved && pattern.test(text)) {
                    resolved = true;
                    resolve({ ready: true, logs: logs.join("") });
                }
            });

            childProcess.on("error", (error: any) => {
                if (!resolved) {
                    resolved = true;
                    resolve({ ready: false, logs: `Error: ${error.message}\n${logs.join("")}` });
                }
            });

            childProcess.on("exit", (code: number) => {
                if (!resolved) {
                    resolved = true;
                    resolve({
                        ready: false,
                        logs: `Process exited with code ${code}\n${logs.join("")}`,
                    });
                }
            });

            setTimeout(() => {
                if (!resolved) {
                    resolved = true;
                    resolve({
                        ready: false,
                        logs: `Timeout waiting for readiness pattern "${logPattern}"\n${logs.join("")}`,
                    });
                }
            }, timeout);
        });
    }
}

export const devServerManager = new DevServerManager();
