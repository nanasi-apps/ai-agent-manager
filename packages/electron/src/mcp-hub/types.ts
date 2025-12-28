import type {
    McpTool,
    McpResource,
    McpResourceTemplate,
    McpResourceContent,
    McpResourceUpdate
} from "@agent-manager/shared";

export interface InternalToolProvider {
    listTools(): Promise<McpTool[]>;
    callTool(name: string, args: any): Promise<any>;
    listResources?(): Promise<McpResource[]>;
    listResourceTemplates?(): Promise<McpResourceTemplate[]>;
    readResource?(uri: string): Promise<McpResourceContent>;
    subscribeResource?(uri: string, onUpdate: (update: McpResourceUpdate) => void): Promise<() => void>;
}
