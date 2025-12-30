import { StreamableHTTPTransport } from "@hono/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

/**
 * Session-based MCP Server Manager
 * 
 * Manages MCP server instances per session, allowing each conversation
 * to have its own set of enabled/disabled tools.
 */
export interface McpSessionConfig {
    sessionId: string;
    enabledTools?: string[]; // If undefined, all tools are enabled
    disabledTools?: string[]; // Tools explicitly disabled
}

interface SessionInstance {
    server: McpServer;
    transport: StreamableHTTPTransport;
    config: McpSessionConfig;
    createdAt: number;
}

// Tool registration function type
type ToolRegistrationFn = (
    server: McpServer,
    sessionId: string,
    config: McpSessionConfig,
) => void;

export class McpSessionManager {
    private sessions: Map<string, SessionInstance> = new Map();
    private toolRegistrationFns: ToolRegistrationFn[] = [];
    private sessionConfigs: Map<string, McpSessionConfig> = new Map();

    /**
     * Register a function that will be called to register tools on new MCP server instances
     */
    registerToolFactory(fn: ToolRegistrationFn) {
        this.toolRegistrationFns.push(fn);
    }

    /**
     * Update session configuration (enabled/disabled tools)
     */
    updateSessionConfig(config: McpSessionConfig) {
        this.sessionConfigs.set(config.sessionId, config);

        // If session already exists, recreate it with new config
        if (this.sessions.has(config.sessionId)) {
            this.destroySession(config.sessionId);
            // Session will be recreated on next request
        }
    }

    /**
     * Get session configuration
     */
    getSessionConfig(sessionId: string): McpSessionConfig | undefined {
        return this.sessionConfigs.get(sessionId);
    }

    /**
     * Get or create an MCP server instance for a session
     */
    async getOrCreateSession(sessionId: string): Promise<SessionInstance> {
        let instance = this.sessions.get(sessionId);

        if (!instance) {
            instance = await this.createSession(sessionId);
            this.sessions.set(sessionId, instance);
        }

        return instance;
    }

    /**
     * Create a new MCP server instance for a session
     */
    private async createSession(sessionId: string): Promise<SessionInstance> {
        const config = this.sessionConfigs.get(sessionId) || { sessionId };

        const server = new McpServer({
            name: `agent-manager-${sessionId}`,
            version: "1.0.0",
        });

        // Register tools using registered factory functions
        for (const fn of this.toolRegistrationFns) {
            fn(server, sessionId, config);
        }

        const transport = new StreamableHTTPTransport({});
        await server.connect(transport);

        console.log(`[McpSessionManager] Created session ${sessionId}`);

        return {
            server,
            transport,
            config,
            createdAt: Date.now(),
        };
    }

    /**
     * Destroy a session and cleanup resources
     */
    destroySession(sessionId: string) {
        const instance = this.sessions.get(sessionId);
        if (instance) {
            // Close transport if possible
            // Note: McpServer doesn't have a close method, but transport might
            console.log(`[McpSessionManager] Destroying session ${sessionId}`);
            this.sessions.delete(sessionId);
        }
    }

    /**
     * Handle an MCP request for a specific session
     */
    async handleRequest(sessionId: string, context: any): Promise<Response> {
        const instance = await this.getOrCreateSession(sessionId);
        const response = await instance.transport.handleRequest(context);
        if (!response) {
            return new Response("MCP transport error", { status: 500 });
        }
        return response;
    }

    /**
     * List all active sessions
     */
    listSessions(): string[] {
        return Array.from(this.sessions.keys());
    }

    /**
     * Check if a tool should be enabled for a session
     */
    isToolEnabled(sessionId: string, toolName: string): boolean {
        const config = this.sessionConfigs.get(sessionId);

        if (!config) {
            return true; // All tools enabled by default
        }

        // If disabledTools is specified, check if tool is in it
        if (config.disabledTools && config.disabledTools.includes(toolName)) {
            return false;
        }

        // If enabledTools is specified, check if tool is in it
        if (config.enabledTools) {
            return config.enabledTools.includes(toolName);
        }

        return true; // Default to enabled
    }

    /**
     * Get list of all registered tools (from first session or template)
     */
    getRegisteredToolNames(): string[] {
        // This would need to be implemented based on how tools are registered
        // For now, return empty - actual implementation depends on tool registration pattern
        return [];
    }

    /**
     * Cleanup old sessions (e.g., sessions older than a certain time)
     */
    cleanup(maxAgeMs: number = 3600000) { // 1 hour default
        const now = Date.now();
        for (const [sessionId, instance] of this.sessions) {
            if (now - instance.createdAt > maxAgeMs) {
                this.destroySession(sessionId);
            }
        }
    }
}

// Singleton instance
export const mcpSessionManager = new McpSessionManager();
