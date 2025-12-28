import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { EventEmitter } from "events";
import { FileSystemProvider, InternalToolProvider } from "./filesystem";

interface McpServerConfig {
    name: string;
    command: string;
    args: string[];
    env?: Record<string, string>;
}

interface ConnectedServer {
    client: Client;
    transport: StdioClientTransport;
    config: McpServerConfig;
}

export class McpHub extends EventEmitter {
    private connections: Map<string, ConnectedServer> = new Map();
    private internalProviders: Map<string, InternalToolProvider> = new Map();

    constructor() {
        super();
        this.registerInternalProvider('internal-fs', new FileSystemProvider());
    }

    private registerInternalProvider(name: string, provider: InternalToolProvider) {
        this.internalProviders.set(name, provider);
    }

    async connectToServer(config: McpServerConfig) {
        if (this.connections.has(config.name)) {
            console.warn(`[McpHub] Server ${config.name} already connected.`);
            return;
        }

        console.log(`[McpHub] Connecting to server: ${config.name} (${config.command} ${config.args.join(' ')})`);

        try {
            const transport = new StdioClientTransport({
                command: config.command,
                args: config.args,
                // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
                env: { ...(process.env as Record<string, string>), ...config.env }
            });

            const client = new Client({
                name: "AgentManagerHub",
                version: "1.0.0"
            }, {
                capabilities: {}
            });

            await client.connect(transport);

            this.connections.set(config.name, {
                client,
                transport,
                config
            });

            console.log(`[McpHub] Connected to ${config.name}`);
            this.emit('server-connected', config.name);

        } catch (error) {
            console.error(`[McpHub] Failed to connect to ${config.name}:`, error);
            throw error;
        }
    }

    async disconnectServer(name: string) {
        const connection = this.connections.get(name);
        if (connection) {
            await connection.client.close(); // Graceful close?
            // transport might not have close method exposed directly in all versions, 
            // but client.close() should handle it or we might need to kill the process if transport exposes it.
            // StdioClientTransport usually kills the process on close/error.
            this.connections.delete(name);
            console.log(`[McpHub] Disconnected ${name}`);
            this.emit('server-disconnected', name);
        }
    }

    getConnectedServers(): McpServerConfig[] {
        return Array.from(this.connections.values()).map(c => c.config);
    }

    async listTools() {
        const allTools = [];

        // Internal tools
        for (const [name, provider] of this.internalProviders) {
            try {
                const tools = await provider.listTools();
                allTools.push(...tools); // Tools from provider should already have serverName set if needed, or we assume unique names?
                // The provider implementation I wrote sets 'serverName'.
            } catch (err) {
                console.error(`[McpHub] Error listing internal tools for ${name}:`, err);
            }
        }

        // External tools
        for (const [name, connection] of this.connections) {
            try {
                const tools = await connection.client.listTools();
                // Tag tools with server name to avoid collisions or just for context
                const taggedTools = tools.tools.map(tool => ({
                    ...tool,
                    serverName: name
                }));
                allTools.push(...taggedTools);
            } catch (err) {
                console.error(`[McpHub] Error listing tools for ${name}:`, err);
            }
        }
        return allTools;
    }

    async callTool(serverName: string, toolName: string, args: any) {
        // Check internal providers first
        if (serverName === 'internal-fs') {
            const provider = this.internalProviders.get('internal-fs');
            if (provider) {
                return await provider.callTool(toolName, args);
            }
        }

        const connection = this.connections.get(serverName);
        if (!connection) {
            throw new Error(`Server ${serverName} not connected`);
        }
        return await connection.client.callTool({
            name: toolName,
            arguments: args
        });
    }
}

export const mcpHub = new McpHub();
