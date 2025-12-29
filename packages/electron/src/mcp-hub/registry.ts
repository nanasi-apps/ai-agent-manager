import type {
    McpTool,
    McpResource,
    McpResourceTemplate,
    McpResourceContent,
    McpResourceUpdate,
    McpServerConfig
} from "@agent-manager/shared";
import type { InternalToolProvider } from "./types";
import type { McpConnectionManager } from "./connection-manager";

export class McpRegistry {
    private internalProviders: Map<string, InternalToolProvider[]> = new Map();

    constructor(private connectionManager: McpConnectionManager) {}

    registerInternalProvider(name: string, provider: InternalToolProvider) {
        const providers = this.internalProviders.get(name) ?? [];
        providers.push(provider);
        this.internalProviders.set(name, providers);
    }

    async listTools(): Promise<McpTool[]> {
        const allTools: McpTool[] = [];

        // Internal tools
        for (const [name, providers] of this.internalProviders) {
            for (const provider of providers) {
                try {
                    const tools = await provider.listTools();
                    // Ensure serverName is set correctly if not already
                     const taggedTools = tools.map(tool => ({
                        ...tool,
                        serverName: tool.serverName || name
                    }));
                    allTools.push(...taggedTools);
                } catch (err) {
                    console.error(`[McpRegistry] Error listing internal tools for ${name}:`, err);
                }
            }
        }

        // External tools
        for (const connection of this.connectionManager.getAllConnections()) {
            try {
                const result = await connection.client.listTools();
                const taggedTools = result.tools.map(tool => ({
                    ...tool,
                    serverName: connection.config.name
                }));
                allTools.push(...taggedTools);
            } catch (err) {
                console.error(`[McpRegistry] Error listing tools for ${connection.config.name}:`, err);
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
                     // Ensure serverName is set
                    const tagged = resources.map(r => ({
                        ...r,
                        serverName: r.serverName || name
                    }));
                    allResources.push(...tagged);
                } catch (err) {
                    console.error(`[McpRegistry] Error listing internal resources for ${name}:`, err);
                }
            }
        }

        for (const connection of this.connectionManager.getAllConnections()) {
            try {
                // Proper typing would be nice here, assuming client matches SDK
                const result = await connection.client.listResources();
                const resources = result.resources || [];
                const tagged = resources.map((resource: any) => ({
                    ...resource,
                    serverName: connection.config.name
                }));
                allResources.push(...tagged);
            } catch (err) {
                console.error(`[McpRegistry] Error listing resources for ${connection.config.name}:`, err);
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
                    const tagged = templates.map(t => ({
                        ...t,
                        serverName: t.serverName || name
                    }));
                    allTemplates.push(...tagged);
                } catch (err) {
                    console.error(`[McpRegistry] Error listing internal resource templates for ${name}:`, err);
                }
            }
        }

        for (const connection of this.connectionManager.getAllConnections()) {
            try {
                const result = await connection.client.listResourceTemplates();
                const templates = result.resourceTemplates || [];
                const tagged = templates.map((template: any) => ({
                    ...template,
                    serverName: connection.config.name
                }));
                allTemplates.push(...tagged);
            } catch (err) {
                console.error(`[McpRegistry] Error listing resource templates for ${connection.config.name}:`, err);
            }
        }

        return allTemplates;
    }

    getInternalProviders(serverName: string): InternalToolProvider[] | undefined {
        return this.internalProviders.get(serverName);
    }
}
