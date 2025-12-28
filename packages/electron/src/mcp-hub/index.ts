import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { createHash } from "node:crypto";
import { EventEmitter } from "events";
import type {
    McpResource,
    McpResourceContent,
    McpResourceTemplate,
    McpResourceUpdate
} from "@agent-manager/shared";
import { FileSystemProvider } from "./filesystem";
import { AgentOrchestrationProvider } from "./providers/agent-orchestrator";
import { CommitSyncProvider } from "./providers/commit-sync";
import { GitWorktreeProvider } from "./providers/git-worktree";
import { WorktreeResourceProvider } from "./resources/worktree-resource";
import { InternalToolProvider } from "./types";

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

function normalizeResourceContent(uri: string, payload: any): McpResourceContent {
    if (payload?.contents && Array.isArray(payload.contents) && payload.contents.length > 0) {
        const first = payload.contents[0];
        return {
            uri: first.uri ?? uri,
            mimeType: first.mimeType,
            text: first.text,
            blob: first.blob
        };
    }

    if (payload?.content && typeof payload.content === "object") {
        const content = payload.content;
        return {
            uri: content.uri ?? uri,
            mimeType: content.mimeType,
            text: content.text,
            blob: content.blob
        };
    }

    if (typeof payload?.text === "string") {
        return { uri, text: payload.text };
    }

    return { uri, text: JSON.stringify(payload, null, 2) };
}

function createPollingSubscription(
    read: () => Promise<McpResourceContent>,
    onUpdate: (update: McpResourceUpdate) => void,
    intervalMs: number = 2000
): () => void {
    let active = true;
    let lastHash = "";

    const poll = async () => {
        if (!active) return;
        const content = await read();
        const payload = content.text ?? content.blob ?? "";
        const hash = createHash("sha1").update(payload).digest("hex");
        if (hash !== lastHash) {
            lastHash = hash;
            onUpdate({ uri: content.uri, content });
        }
    };

    poll().catch((error) => {
        console.warn("[McpHub] Initial resource poll failed", error);
    });

    const timer = setInterval(() => {
        poll().catch((error) => {
            console.warn("[McpHub] Resource poll failed", error);
        });
    }, intervalMs);

    return () => {
        active = false;
        clearInterval(timer);
    };
}

export class McpHub extends EventEmitter {
    private connections: Map<string, ConnectedServer> = new Map();
    private internalProviders: Map<string, InternalToolProvider[]> = new Map();

    constructor() {
        super();
        this.registerInternalProvider('agents-manager-mcp', new FileSystemProvider());
        this.registerInternalProvider('agents-manager-mcp', new GitWorktreeProvider());
        this.registerInternalProvider('agents-manager-mcp', new WorktreeResourceProvider());
        this.registerInternalProvider('agents-manager-mcp', new CommitSyncProvider());
        this.registerInternalProvider('agents-manager-mcp', new AgentOrchestrationProvider());
    }

    private registerInternalProvider(name: string, provider: InternalToolProvider) {
        const providers = this.internalProviders.get(name) ?? [];
        providers.push(provider);
        this.internalProviders.set(name, providers);
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
        for (const [name, providers] of this.internalProviders) {
            for (const provider of providers) {
                try {
                    const tools = await provider.listTools();
                    allTools.push(...tools); // Tools from provider should already have serverName set if needed, or we assume unique names?
                    // The provider implementation I wrote sets 'serverName'.
                } catch (err) {
                    console.error(`[McpHub] Error listing internal tools for ${name}:`, err);
                }
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

    async listResources(): Promise<McpResource[]> {
        const allResources: McpResource[] = [];

        for (const [name, providers] of this.internalProviders) {
            for (const provider of providers) {
                if (!provider.listResources) continue;
                try {
                    const resources = await provider.listResources();
                    allResources.push(...resources);
                } catch (err) {
                    console.error(`[McpHub] Error listing internal resources for ${name}:`, err);
                }
            }
        }

        for (const [name, connection] of this.connections) {
            try {
                const clientAny = connection.client as any;
                if (typeof clientAny.listResources !== "function") continue;
                const result = await clientAny.listResources();
                const resources = result?.resources ?? result ?? [];
                const tagged = resources.map((resource: any) => ({
                    ...resource,
                    serverName: name
                }));
                allResources.push(...tagged);
            } catch (err) {
                console.error(`[McpHub] Error listing resources for ${name}:`, err);
            }
        }

        return allResources;
    }

    async listResourceTemplates(): Promise<McpResourceTemplate[]> {
        const allTemplates: McpResourceTemplate[] = [];

        for (const [name, providers] of this.internalProviders) {
            for (const provider of providers) {
                if (!provider.listResourceTemplates) continue;
                try {
                    const templates = await provider.listResourceTemplates();
                    allTemplates.push(...templates);
                } catch (err) {
                    console.error(`[McpHub] Error listing internal resource templates for ${name}:`, err);
                }
            }
        }

        for (const [name, connection] of this.connections) {
            try {
                const clientAny = connection.client as any;
                if (typeof clientAny.listResourceTemplates !== "function") continue;
                const result = await clientAny.listResourceTemplates();
                const templates = result?.resourceTemplates ?? result ?? [];
                const tagged = templates.map((template: any) => ({
                    ...template,
                    serverName: name
                }));
                allTemplates.push(...tagged);
            } catch (err) {
                console.error(`[McpHub] Error listing resource templates for ${name}:`, err);
            }
        }

        return allTemplates;
    }

    async readResource(serverName: string, uri: string): Promise<McpResourceContent> {
        const providers = this.internalProviders.get(serverName);
        if (providers && providers.length > 0) {
            let lastError: unknown;
            for (const provider of providers) {
                if (!provider.readResource) continue;
                try {
                    return await provider.readResource(uri);
                } catch (err) {
                    lastError = err;
                }
            }
            if (lastError) {
                throw lastError;
            }
            throw new Error(`Internal resource ${uri} not found for server ${serverName}`);
        }

        const connection = this.connections.get(serverName);
        if (!connection) {
            throw new Error(`Server ${serverName} not connected`);
        }
        const clientAny = connection.client as any;
        if (typeof clientAny.readResource !== "function") {
            throw new Error(`Server ${serverName} does not support resources`);
        }
        const result = await clientAny.readResource({ uri });
        return normalizeResourceContent(uri, result);
    }

    async subscribeResource(
        serverName: string,
        uri: string,
        onUpdate: (update: McpResourceUpdate) => void
    ): Promise<() => void> {
        const providers = this.internalProviders.get(serverName);
        if (providers && providers.length > 0) {
            for (const provider of providers) {
                if (!provider.subscribeResource) continue;
                return await provider.subscribeResource(uri, onUpdate);
            }
            return createPollingSubscription(() => this.readResource(serverName, uri), onUpdate);
        }

        const connection = this.connections.get(serverName);
        if (!connection) {
            throw new Error(`Server ${serverName} not connected`);
        }
        const clientAny = connection.client as any;
        if (typeof clientAny.subscribeResource === "function") {
            const subscription = await clientAny.subscribeResource({ uri, onUpdate });
            if (typeof subscription === "function") {
                return subscription;
            }
            if (subscription?.unsubscribe) {
                return () => subscription.unsubscribe();
            }
        }
        return createPollingSubscription(() => this.readResource(serverName, uri), onUpdate);
    }

    async callTool(serverName: string, toolName: string, args: any) {
        const providers = this.internalProviders.get(serverName);
        if (providers && providers.length > 0) {
            for (const provider of providers) {
                try {
                    const tools = await provider.listTools();
                    if (tools.some((tool) => tool.name === toolName)) {
                        return await provider.callTool(toolName, args);
                    }
                } catch (err) {
                    console.error(`[McpHub] Error resolving internal tool ${toolName} for ${serverName}:`, err);
                }
            }
            throw new Error(`Internal tool ${toolName} not found for server ${serverName}`);
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
