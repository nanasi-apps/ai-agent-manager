export type TextContent = {
	type: "text";
	text: string;
};

export type ToolResult = {
	content: TextContent[];
	isError?: boolean;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- intentional for flexibility in tool signatures
export type ToolHandler = (
	args: Record<string, unknown>,
	extra: Record<string, unknown>,
) => Promise<ToolResult>;

export interface ToolInputSchema {
	description?: string;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Zod types are inherently any-based
	inputSchema?: Record<string, unknown>;
}

export type ToolRegistrar = (
	name: string,
	schema: ToolInputSchema,
	handler: ToolHandler,
) => void;
