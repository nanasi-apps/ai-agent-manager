import { spawn } from "node:child_process";
import { shell } from "electron";
import { getStoreOrThrow, getLogger, type AutoConfig } from "@agent-manager/shared";
import { allocatePorts } from "../server/utils/port-utils";

const logger = getLogger(["electron", "dev-server-manager"]);

export interface RunningProcess {
    pid: number;
    command: string;
    projectId: string;
    ports: Record<string, number>;
    startedAt: number;
    type: "web" | "process" | "other";
    url?: string;
    conversationId?: string;
    logs: string[];
    status: 'running' | 'stopped' | 'error';
    exitCode?: number | null;
}

class DevServerManager {
    private runningProcesses = new Map<string, RunningProcess>();

    private getProcessKey(projectId: string, conversationId?: string): string {
        return conversationId ? `${projectId}:${conversationId}` : projectId;
    }

    getRunningProject(projectId: string, conversationId?: string): RunningProcess | undefined {
        const key = this.getProcessKey(projectId, conversationId);
        return this.runningProcesses.get(key);
    }

    listRunningProjects(): RunningProcess[] {
        return Array.from(this.runningProcesses.values()).filter(p => p.status === 'running');
    }

    getProjectLogs(projectId: string, conversationId?: string): string[] {
        const key = this.getProcessKey(projectId, conversationId);
        const running = this.runningProcesses.get(key);
        return running?.logs ?? [];
    }

    async stopProject(projectId: string, conversationId?: string): Promise<boolean> {
        const key = this.getProcessKey(projectId, conversationId);
        const running = this.runningProcesses.get(key);

        // If it exists but is not running, we just return true (already stopped)
        // AND we probably want to update status if not updated? 
        // But if it's in map and status is running, we kill it.
        if (!running) return false;
        if (running.status !== 'running') return true;

        try {
            // Clean up child process
            try {
                process.kill(-running.pid, "SIGTERM");
            } catch (e: any) {
                // ignore if already dead
                if (e.code !== 'ESRCH') {
                    logger.info("Failed to kill process group {pid}: {err}", { pid: running.pid, err: e });
                }
            }

            running.status = 'stopped';
            // We keep it in the map to preserve logs
            return true;
        } catch (error) {
            running.status = 'error';
            throw error;
        }
    }

    async stopAll(): Promise<void> {
        logger.info("Stopping all running projects...");
        const promises: Promise<boolean>[] = [];
        for (const process of this.runningProcesses.values()) {
            if (process.status === 'running') {
                promises.push(this.stopProject(process.projectId, process.conversationId));
            }
        }
        await Promise.allSettled(promises);
        // We DO clear on stopAll (app exit)
        this.runningProcesses.clear();
    }

    async launchProject(
        projectId: string,
        options: { timeout?: number; cwd?: string; conversationId?: string; configName?: string } = {},
    ): Promise<RunningProcess> {
        const { timeout = 60000, cwd: overrideCwd, conversationId, configName } = options;
        logger.info(
            "Launching project {projectId} (conversation: {conversationId}, cwd: {cwd}, config: {configName})",
            { projectId, conversationId: conversationId ?? "none", cwd: overrideCwd ?? "default", configName: configName ?? "auto" },
        );

        const key = this.getProcessKey(projectId, conversationId);
        const existing = this.runningProcesses.get(key);
        if (existing && existing.status === 'running') {
            return existing;
        }

        try {
            const store = getStoreOrThrow();
            const project = store.getProject(projectId);

            if (!project) throw new Error(`Project ${projectId} not found`);

            let config: AutoConfig | undefined;

            if (configName) {
                config = project.launchConfigs?.find(c => c.name === configName);
                if (!config) throw new Error(`Launch configuration "${configName}" not found for project "${project.name}"`);
            } else {
                // Fallback / Auto logic
                // 1. Try launchConfigs[0] if exists
                if (project.launchConfigs && project.launchConfigs.length > 0) {
                    config = project.launchConfigs[0];
                }
                // 2. Try autoConfig
                else {
                    config = project.autoConfig;
                }
            }

            if (!config) throw new Error(`Project "${project.name}" does not have Agent Configuration set up.`);
            if (!project.rootPath) throw new Error(`Project "${project.name}" does not have a root path set`);

            // Use worktree cwd if provided, otherwise use project root
            const workingDir = overrideCwd ?? project.rootPath;

            // 1. Allocate ports
            logger.debug("Allocating ports for project {projectId}", { projectId });
            const portRequests: Record<string, number> = {};

            if (config.services && config.services.length > 0) {
                for (const svc of config.services) {
                    portRequests[svc.envKey] = svc.default;
                }
            } else if ((config as any).ports) {
                // Backward compatibility for legacy config
                logger.info("Using legacy 'ports' configuration");
                const legacyPorts = (config as any).ports as Record<string, number>;
                for (const [key, val] of Object.entries(legacyPorts)) {
                    portRequests[key] = val;
                }
            }

            const allocatedPorts = await allocatePorts(portRequests);
            logger.debug("Allocated ports: {allocatedPorts}", { allocatedPorts });

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

            logger.info("Spawning: {fullCommand} in {workingDir}", { fullCommand, workingDir });

            const childProcess = spawn(fullCommand, {
                cwd: workingDir,
                env,
                shell: true,
                stdio: ["ignore", "pipe", "pipe"],
                detached: true,
            });

            // Capture logs
            const logs: string[] = [];
            const logHandler = (data: Buffer | string, isError: boolean) => {
                const text = data.toString();
                // Strip ANSI codes if needed, or keep for frontend rendering?
                // For now, keep as is.
                logs.push(text);
                // Optional: Limit log size to prevent memory leaks
                if (logs.length > 5000) logs.shift();
            };

            childProcess.stdout?.on("data", (d) => logHandler(d, false));
            childProcess.stderr?.on("data", (d) => logHandler(d, true));

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
                logs,
                status: 'running'
            };
            this.runningProcesses.set(key, processInfo);

            // Add global exit/error listeners to update status
            childProcess.on('exit', (code, signal) => {
                logger.info(
                    "Project {projectId} exited with code {code} signal {signal}",
                    { projectId, code, signal },
                );
                if (processInfo.status === 'running') {
                    processInfo.status = code === 0 ? 'stopped' : 'error';
                    processInfo.exitCode = code;
                }
            });

            childProcess.on('error', (err) => {
                logger.error("Project {projectId} error: {err}", { projectId, err });
                if (processInfo.status === 'running') {
                    processInfo.status = 'error';
                }
            });

            // 4. Wait for readiness (if configured)
            const readinessConfig = config.readiness || (config as any).readiness;

            if (readinessConfig && readinessConfig.logPattern) {
                logger.info(
                    "Waiting for readiness: {logPattern}",
                    { logPattern: readinessConfig.logPattern },
                );
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
                        // try {
                        //     await shell.openExternal(url);
                        // } catch (e) {
                        //     console.error("Failed to open browser:", e);
                        // }
                    }
                }
            } else {
                // Legacy fallback
                if (config.type === 'web') {
                    const mainPort = Object.values(allocatedPorts)[0];
                    if (mainPort) {
                        const url = `http://localhost:${mainPort}`;
                        processInfo.url = url;
                        // try {
                        //     await shell.openExternal(url);
                        // } catch (e) {
                        //     console.error("Failed to open browser:", e);
                        // }
                    }
                }
            }

            return processInfo;

        } catch (error) {
            logger.error("Error launching project {projectId}: {error}", { projectId, error });
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
