import type {
	McpResource,
	McpResourceContent,
	McpResourceTemplate,
	McpResourceUpdate,
	McpServerConfig,
} from "@agent-manager/shared";
import { EventEmitter } from "events";
import { McpConnectionManager } from "./connection-manager";
import { FileSystemProvider } from "./filesystem";
import { AgentOrchestrationProvider } from "./providers/agent-orchestrator";
import { CommitSyncProvider } from "./providers/commit-sync";
import { GitWorktreeProvider } from "./providers/git-worktree";
import { McpRegistry } from "./registry";
import { WorktreeResourceProvider } from "./resources/worktree-resource";
import { createPollingSubscription } from "./utils";

function normalizeResourceContent(
	uri: string,
	payload: any,
): McpResourceContent {
	if (
		payload?.contents &&
		Array.isArray(payload.contents) &&
		payload.contents.length > 0
	) {
		const first = payload.contents[0];
		return {
			uri: first.uri ?? uri,
			mimeType: first.mimeType,
			text: first.text,
			blob: first.blob,
		};
	}

	if (payload?.content && typeof payload.content === "object") {
		const content = payload.content;
		return {
			uri: content.uri ?? uri,
			mimeType: content.mimeType,
			text: content.text,
			blob: content.blob,
		};
	}

	if (typeof payload?.text === "string") {
		return { uri, text: payload.text };
	}

	return { uri, text: JSON.stringify(payload, null, 2) };
}

export class McpHub extends EventEmitter {
	private connectionManager: McpConnectionManager;
	private registry: McpRegistry;

	constructor() {
		super();
		this.connectionManager = new McpConnectionManager();
		this.registry = new McpRegistry(this.connectionManager);

		// Forward connection events
		this.connectionManager.on("connected", (name) =>
			this.emit("server-connected", name),
		);
		this.connectionManager.on("disconnected", (name) =>
			this.emit("server-disconnected", name),
		);

		// Register internal providers
		this.registry.registerInternalProvider(
			"agents-manager-mcp",
			new FileSystemProvider(),
		);
		this.registry.registerInternalProvider(
			"agents-manager-mcp",
			new GitWorktreeProvider(),
		);
		this.registry.registerInternalProvider(
			"agents-manager-mcp",
			new WorktreeResourceProvider(),
		);
		this.registry.registerInternalProvider(
			"agents-manager-mcp",
			new CommitSyncProvider(),
		);
		this.registry.registerInternalProvider(
			"agents-manager-mcp",
			new AgentOrchestrationProvider(),
		);
	}

	async connectToServer(config: McpServerConfig) {
		return this.connectionManager.connect(config);
	}

	async disconnectServer(name: string) {
		return this.connectionManager.disconnect(name);
	}

	getConnectedServers(): McpServerConfig[] {
		return this.connectionManager.getConnectedConfigs();
	}

	async listTools() {
		return this.registry.listTools();
	}

	async listResources(): Promise<McpResource[]> {
		return this.registry.listResources();
	}

	async listResourceTemplates(): Promise<McpResourceTemplate[]> {
		return this.registry.listResourceTemplates();
	}

	async readResource(
		serverName: string,
		uri: string,
	): Promise<McpResourceContent> {
		const internalProviders = this.registry.getInternalProviders(serverName);
		if (internalProviders && internalProviders.length > 0) {
			let lastError: unknown;
			for (const provider of internalProviders) {
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
			throw new Error(
				`Internal resource ${uri} not found for server ${serverName}`,
			);
		}

		const connection = this.connectionManager.getConnection(serverName);
		if (!connection) {
			throw new Error(`Server ${serverName} not connected`);
		}

		const result = await connection.client.readResource({ uri });
		return normalizeResourceContent(uri, result);
	}

	async subscribeResource(
		serverName: string,
		uri: string,
		onUpdate: (update: McpResourceUpdate) => void,
	): Promise<() => void> {
		const internalProviders = this.registry.getInternalProviders(serverName);
		if (internalProviders && internalProviders.length > 0) {
			for (const provider of internalProviders) {
				if (!provider.subscribeResource) continue;
				return await provider.subscribeResource(uri, onUpdate);
			}
			return createPollingSubscription(
				() => this.readResource(serverName, uri),
				onUpdate,
			);
		}

		const connection = this.connectionManager.getConnection(serverName);
		if (!connection) {
			throw new Error(`Server ${serverName} not connected`);
		}

		// Use any cast until SDK types are perfectly aligned or we wrap client
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
		return createPollingSubscription(
			() => this.readResource(serverName, uri),
			onUpdate,
		);
	}

	async callTool(serverName: string, toolName: string, args: any) {
		const internalProviders = this.registry.getInternalProviders(serverName);
		if (internalProviders && internalProviders.length > 0) {
			for (const provider of internalProviders) {
				try {
					const tools = await provider.listTools();
					if (tools.some((tool) => tool.name === toolName)) {
						return await provider.callTool(toolName, args);
					}
				} catch (err) {
					console.error(
						`[McpHub] Error resolving internal tool ${toolName} for ${serverName}:`,
						err,
					);
				}
			}
			throw new Error(
				`Internal tool ${toolName} not found for server ${serverName}`,
			);
		}

		const connection = this.connectionManager.getConnection(serverName);
		if (!connection) {
			throw new Error(`Server ${serverName} not connected`);
		}
		return await connection.client.callTool({
			name: toolName,
			arguments: args,
		});
	}
}

export const mcpHub = new McpHub();
