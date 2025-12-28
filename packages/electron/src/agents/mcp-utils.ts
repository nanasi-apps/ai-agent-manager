import { mcpHub } from '../mcp-hub';
import { AgentConfig } from '@agent-manager/shared';

export async function getMcpToolInstructions(): Promise<string> {
    try {
        const [tools, resources, templates] = await Promise.all([
            mcpHub.listTools(),
            mcpHub.listResources(),
            mcpHub.listResourceTemplates()
        ]);
        if ((!tools || tools.length === 0) && (!resources || resources.length === 0) && (!templates || templates.length === 0)) {
            return '';
        }

        const toolSection = tools && tools.length > 0
            ? `

[Available MCP Tools]
You have access to the following tools via the Model Context Protocol (MCP). To use a tool, output a JSON object with the format: {"tool": "tool_name", "arguments": { ... }}.

${JSON.stringify(tools, null, 2)}`
            : '';

        const resourceSection = resources && resources.length > 0
            ? `

[Available MCP Resources]
Resources can be read by URI. Use them to fetch worktree metadata, status, or diff snapshots.

${JSON.stringify(resources, null, 2)}`
            : '';

        const templateSection = templates && templates.length > 0
            ? `

[Available MCP Resource Templates]
Templates describe dynamic resources. Substitute variables like {branch} when reading.

${JSON.stringify(templates, null, 2)}`
            : '';

        return `${toolSection}${resourceSection}${templateSection}`;
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
