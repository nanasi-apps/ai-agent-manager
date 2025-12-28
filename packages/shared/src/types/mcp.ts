export interface McpServerConfig {
    name: string;
    command: string;
    args: string[];
    env?: Record<string, string>;
}

export interface McpTool {
    name: string;
    description?: string;
    inputSchema?: object;
    serverName: string;
}

export interface IMcpManager {
    connectToServer(config: McpServerConfig): Promise<void>;
    disconnectServer(name: string): Promise<void>;
    getConnectedServers(): McpServerConfig[];
    listTools(): Promise<McpTool[]>;
    callTool(serverName: string, toolName: string, args: any): Promise<any>;
}
