import { mcpHub } from '../mcp-hub';
import { AgentConfig } from '@agent-manager/shared';

export async function getMcpToolInstructions(): Promise<string> {
    try {
        const tools = await mcpHub.listTools();
        if (!tools || tools.length === 0) {
            return '';
        }

        return `

[Available MCP Tools]
You have access to the following tools via the Model Context Protocol (MCP). To use a tool, output a JSON object with the format: {"tool": "tool_name", "arguments": { ... }}.

${JSON.stringify(tools, null, 2)}`;
    } catch (error) {
        console.error('Failed to fetch MCP tools', error);
        return '';
    }
}

export async function executeMcpTool(toolName: string, args: any, serverName?: string): Promise<string> {
    try {
        // If serverName is known, use it. Otherwise, we might need to find it?
        // mcpHub.callTool requires serverName.
        // But the agent might not provide serverName if it just output {"tool": "name"}.
        // We need to look up the server name for the tool.
        
        // Let's get the list of tools to find the server
        const tools = await mcpHub.listTools();
        const toolDef = tools.find(t => t.name === toolName);
        
        if (!toolDef) {
            return `Error: Tool ${toolName} not found.`;
        }

        const result = await mcpHub.callTool(toolDef.serverName, toolName, args);
        
        // The result format depends on MCP SDK.
        // Usually it returns { content: [ { type: 'text', text: '...' } ], isError: boolean }
        
        if (result.isError) {
             return `Error executing tool ${toolName}: ${JSON.stringify(result)}`;
        }

        if (result.content && Array.isArray(result.content)) {
            return result.content.map((c: any) => c.text || JSON.stringify(c)).join('\n');
        }

        return JSON.stringify(result);

    } catch (error) {
        return `Error executing tool ${toolName}: ${error instanceof Error ? error.message : String(error)}`;
    }
}
