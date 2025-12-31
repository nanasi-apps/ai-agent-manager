export type TextContent = {
	type: "text";
	text: string;
};

export type ToolResult = {
	content: TextContent[];
	isError?: boolean;
};

export type ToolHandler = (args: any, extra: any) => Promise<ToolResult>;

export type ToolRegistrar = (
	name: string,
	schema: { description?: string; inputSchema?: any },
	handler: ToolHandler,
) => void;
