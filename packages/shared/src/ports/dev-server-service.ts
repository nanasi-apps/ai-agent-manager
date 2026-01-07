/**
 * IDevServerService - Port interface for development server management
 *
 * This interface defines the contract for launching and managing
 * development servers for projects (e.g., npm run dev).
 */

export interface IRunningProcess {
    pid: number;
    command: string;
    projectId: string;
    ports: Record<string, number>;
    startedAt: number;
    type: "web" | "process" | "other";
    url?: string;
    conversationId?: string;
    logs: string[];
    status: "running" | "stopped" | "error";
    exitCode?: number | null;
}

export interface IDevServerService {
    getRunningProject(
        projectId: string,
        conversationId?: string,
    ): IRunningProcess | undefined;

    listRunningProjects(): IRunningProcess[];

    stopProject(projectId: string, conversationId?: string): Promise<boolean>;

    launchProject(
        projectId: string,
        options?: {
            timeout?: number;
            cwd?: string;
            conversationId?: string;
            configName?: string;
        },
    ): Promise<IRunningProcess>;

    getProjectLogs(projectId: string, conversationId?: string): string[];
}
