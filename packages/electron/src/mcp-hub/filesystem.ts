import * as fs from 'fs/promises';
import * as path from 'path';
import { McpTool } from '@agent-manager/shared';

export interface InternalToolProvider {
    listTools(): Promise<McpTool[]>;
    callTool(name: string, args: any): Promise<any>;
}

export class FileSystemProvider implements InternalToolProvider {
    async listTools(): Promise<McpTool[]> {
        return [
            {
                name: 'read_file',
                description: 'Read the contents of a file',
                inputSchema: {
                    type: 'object',
                    properties: {
                        path: { type: 'string', description: 'Absolute path to the file' }
                    },
                    required: ['path']
                },
                serverName: 'internal-fs'
            },
            {
                name: 'write_file',
                description: 'Write content to a file (overwrites)',
                inputSchema: {
                    type: 'object',
                    properties: {
                        path: { type: 'string', description: 'Absolute path to the file' },
                        content: { type: 'string', description: 'Content to write' }
                    },
                    required: ['path', 'content']
                },
                serverName: 'internal-fs'
            },
            {
                name: 'replace_file_content',
                description: 'Replace a specific string in a file with new content',
                inputSchema: {
                    type: 'object',
                    properties: {
                        path: { type: 'string', description: 'Absolute path to the file' },
                        target: { type: 'string', description: 'String to replace' },
                        replacement: { type: 'string', description: 'New string' }
                    },
                    required: ['path', 'target', 'replacement']
                },
                serverName: 'internal-fs'
            },
            {
                name: 'list_directory',
                description: 'List files in a directory',
                inputSchema: {
                    type: 'object',
                    properties: {
                        path: { type: 'string', description: 'Absolute path to the directory' }
                    },
                    required: ['path']
                },
                serverName: 'internal-fs'
            }
        ];
    }

    async callTool(name: string, args: any): Promise<any> {
        switch (name) {
            case 'read_file':
                return await fs.readFile(args.path, 'utf-8');
            case 'write_file':
                await fs.mkdir(path.dirname(args.path), { recursive: true });
                await fs.writeFile(args.path, args.content, 'utf-8');
                return `Successfully wrote to ${args.path}`;
            case 'replace_file_content': {
                const content = await fs.readFile(args.path, 'utf-8');
                if (!content.includes(args.target)) {
                    throw new Error(`Target string not found in file: ${args.path}`);
                }
                const newContent = content.replace(args.target, args.replacement);
                await fs.writeFile(args.path, newContent, 'utf-8');
                return `Successfully replaced content in ${args.path}`;
            }
            case 'list_directory':
                const files = await fs.readdir(args.path);
                return files;
            default:
                throw new Error(`Unknown tool: ${name}`);
        }
    }
}
