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

export interface McpResource {
	uri: string;
	name?: string;
	description?: string;
	mimeType?: string;
	serverName: string;
}

export interface McpResourceTemplate {
	uriTemplate: string;
	name?: string;
	description?: string;
	mimeType?: string;
	serverName: string;
}

export interface McpResourceContent {
	uri: string;
	mimeType?: string;
	text?: string;
	blob?: string;
}

export interface McpResourceUpdate {
	uri: string;
	content: McpResourceContent;
}

export interface IMcpManager {
	connectToServer(config: McpServerConfig): Promise<void>;
	disconnectServer(name: string): Promise<void>;
	getConnectedServers(): McpServerConfig[];
	listTools(): Promise<McpTool[]>;
	callTool(serverName: string, toolName: string, args: any): Promise<any>;
	listResources(): Promise<McpResource[]>;
	listResourceTemplates(): Promise<McpResourceTemplate[]>;
	readResource(serverName: string, uri: string): Promise<McpResourceContent>;
	subscribeResource(
		serverName: string,
		uri: string,
		onUpdate: (update: McpResourceUpdate) => void,
	): Promise<() => void>;
}
