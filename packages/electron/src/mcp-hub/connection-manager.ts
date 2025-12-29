import type { McpServerConfig } from "@agent-manager/shared";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { EventEmitter } from "events";

interface ConnectedServer {
	client: Client;
	transport: StdioClientTransport;
	config: McpServerConfig;
}

export class McpConnectionManager extends EventEmitter {
	private connections: Map<string, ConnectedServer> = new Map();

	async connect(config: McpServerConfig) {
		if (this.connections.has(config.name)) {
			console.warn(
				`[McpConnectionManager] Server ${config.name} already connected.`,
			);
			return;
		}

		console.log(
			`[McpConnectionManager] Connecting to server: ${config.name} (${config.command} ${config.args.join(" ")})`,
		);

		try {
			const transport = new StdioClientTransport({
				command: config.command,
				args: config.args,
				// eslint-disable-next-line @typescript-eslint/consistent-type-assertions
				env: { ...(process.env as Record<string, string>), ...config.env },
			});

			const client = new Client(
				{
					name: "AgentManagerHub",
					version: "1.0.0",
				},
				{
					capabilities: {},
				},
			);

			await client.connect(transport);

			this.connections.set(config.name, {
				client,
				transport,
				config,
			});

			console.log(`[McpConnectionManager] Connected to ${config.name}`);
			this.emit("connected", config.name);
		} catch (error) {
			console.error(
				`[McpConnectionManager] Failed to connect to ${config.name}:`,
				error,
			);
			throw error;
		}
	}

	async disconnect(name: string) {
		const connection = this.connections.get(name);
		if (connection) {
			try {
				await connection.client.close();
			} catch (error) {
				console.error(
					`[McpConnectionManager] Error closing client for ${name}:`,
					error,
				);
			}
			this.connections.delete(name);
			console.log(`[McpConnectionManager] Disconnected ${name}`);
			this.emit("disconnected", name);
		}
	}

	getConnection(name: string): ConnectedServer | undefined {
		return this.connections.get(name);
	}

	getAllConnections(): ConnectedServer[] {
		return Array.from(this.connections.values());
	}

	getConnectedConfigs(): McpServerConfig[] {
		return Array.from(this.connections.values()).map((c) => c.config);
	}
}
