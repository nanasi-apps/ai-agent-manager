import type { McpTool } from "@agent-manager/shared";
import { orchestrationManager } from "../../main/orchestration-manager";
import type { InternalToolProvider } from "../types";

export class AgentOrchestrationProvider implements InternalToolProvider {
	async listTools(): Promise<McpTool[]> {
		return [
			{
				name: "dispatch_task",
				description:
					"Dispatch a task to an agent session (starts session if not running)",
				inputSchema: {
					type: "object",
					properties: {
						sessionId: { type: "string", description: "Target session ID" },
						message: {
							type: "string",
							description: "Task description or message",
						},
						agentType: {
							type: "string",
							description:
								"Agent type (e.g. 'gemini', 'claude', 'custom') - required if starting new session",
						},
						command: {
							type: "string",
							description: "Command to run agent - overrides agentType default",
						},
						agentModel: { type: "string", description: "Model name" },
						cwd: {
							type: "string",
							description: "Working directory for the agent",
						},
						env: { type: "object", description: "Environment variables" },
						streamJson: {
							type: "boolean",
							description: "Whether the agent streams JSON (default: false)",
						},
					},
					required: ["sessionId", "message"],
				},
				serverName: "agents-manager-mcp",
			},
			{
				name: "get_agent_status",
				description: "Get status of all known agent sessions",
				inputSchema: {
					type: "object",
					properties: {},
				},
				serverName: "agents-manager-mcp",
			},
			{
				name: "broadcast_context",
				description: "Broadcast a message/context to multiple agents",
				inputSchema: {
					type: "object",
					properties: {
						message: { type: "string", description: "Message to broadcast" },
						sessionIds: {
							type: "array",
							items: { type: "string" },
							description: "Specific sessions to target (default: all)",
						},
					},
					required: ["message"],
				},
				serverName: "agents-manager-mcp",
			},
		];
	}

	async callTool(name: string, args: any): Promise<any> {
		switch (name) {
			case "dispatch_task":
				return await orchestrationManager.dispatchTask({
					sessionId: args.sessionId,
					message: args.message,
					agentType: args.agentType,
					command: args.command,
					agentModel: args.agentModel,
					cwd: args.cwd,
					env: args.env,
					streamJson: args.streamJson,
				});

			case "get_agent_status":
				return orchestrationManager.getAgentStatuses();

			case "broadcast_context":
				return await orchestrationManager.broadcastContext({
					message: args.message,
					sessionIds: args.sessionIds,
				});

			default:
				throw new Error(`Unknown tool: ${name}`);
		}
	}
}
