import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPTransport } from "@hono/mcp";
import * as fs from "fs/promises";
import * as path from "path";
import { z } from "zod";

export async function startMcpServer(port: number = 3001) {
    const server = new McpServer({
        name: "agent-manager",
        version: "1.0.0"
    });

    // Register FS tools
    server.tool(
        "read_file",
        {
            path: z.string().describe("Absolute path to the file"),
        },
        async ({ path: filePath }) => {
            try {
                const content = await fs.readFile(filePath, "utf-8");
                return {
                    content: [{ type: "text", text: content }],
                };
            } catch (error: any) {
                return {
                    content: [{ type: "text", text: `Error reading file: ${error.message}` }],
                    isError: true,
                };
            }
        }
    );

    server.tool(
        "write_file",
        {
            path: z.string().describe("Absolute path to the file"),
            content: z.string().describe("Content to write"),
        },
        async ({ path: filePath, content }) => {
            try {
                await fs.mkdir(path.dirname(filePath), { recursive: true });
                await fs.writeFile(filePath, content, "utf-8");
                return {
                    content: [{ type: "text", text: `Successfully wrote to ${filePath}` }],
                };
            } catch (error: any) {
                return {
                    content: [{ type: "text", text: `Error writing file: ${error.message}` }],
                    isError: true,
                };
            }
        }
    );

    server.tool(
        "replace_file_content",
        {
            path: z.string().describe("Absolute path to the file"),
            target: z.string().describe("String to replace"),
            replacement: z.string().describe("New string"),
        },
        async ({ path: filePath, target, replacement }) => {
            try {
                const content = await fs.readFile(filePath, "utf-8");
                if (!content.includes(target)) {
                    return {
                        content: [{ type: "text", text: `Target string not found in file: ${filePath}` }],
                        isError: true
                    };
                }
                const newContent = content.replace(target, replacement);
                await fs.writeFile(filePath, newContent, "utf-8");
                return {
                    content: [{ type: "text", text: `Successfully replaced content in ${filePath}` }],
                };
            } catch (error: any) {
                return {
                    content: [{ type: "text", text: `Error replacing content: ${error.message}` }],
                    isError: true,
                };
            }
        }
    );

    server.tool(
        "list_directory",
        {
            path: z.string().describe("Absolute path to the directory"),
        },
        async ({ path: dirPath }) => {
            try {
                const files = await fs.readdir(dirPath);
                return {
                    content: [{ type: "text", text: JSON.stringify(files, null, 2) }],
                };
            } catch (error: any) {
                return {
                    content: [{ type: "text", text: `Error listing directory: ${error.message}` }],
                    isError: true,
                };
            }
        }
    );

    const app = new Hono();

    // Setup StreamableHTTPTransport from @hono/mcp
    // Assuming constructor takes options including endpoint
    const transport = new StreamableHTTPTransport({});

    await server.connect(transport);

    // Middleware to log all requests
    app.use("*", async (c, next) => {
        console.log(`[McpServer] ${c.req.method} ${c.req.url}`);
        await next();
        console.log(`[McpServer] Response status: ${c.res.status}`);
    });

    app.all("/mcp/*", async (c) => {
        console.log(`[McpServer] Handling MCP request: ${c.req.url}`);
        return transport.handleRequest(c as any);
    });

    // Also handle simple health check
    app.get("/health", (c) => c.text("OK"));

    console.log(`[McpServer] Starting on port ${port}`);

    // We start the server independently
    serve({
        fetch: app.fetch,
        port
    });

    return app;
}
