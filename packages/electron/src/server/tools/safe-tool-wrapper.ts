import type { z } from "zod";

/**
 * MCP tool response type
 */
export interface ToolResponse {
	content: Array<{ type: "text"; text: string }>;
	isError?: boolean;
}

/**
 * Tool handler function type
 */
export type ToolHandler<T> = (args: T, extra: any) => Promise<ToolResponse>;

/**
 * Tool schema definition
 */
export interface ToolSchema {
	description: string;
	inputSchema: Record<string, z.ZodType<any>>;
}

/**
 * Tool registrar function type
 */
export type ToolRegistrar = (
	name: string,
	schema: ToolSchema,
	handler: ToolHandler<any>,
) => void;

/**
 * Create a safe tool handler that wraps the original handler with error handling.
 * This reduces boilerplate try/catch blocks in individual tool implementations.
 *
 * @param handler - The original tool handler
 * @param errorPrefix - Prefix for error messages (e.g., "Error getting git status")
 * @returns A wrapped handler that catches errors and returns proper error responses
 */
export function createSafeHandler<T>(
	handler: (args: T, extra: any) => Promise<string | ToolResponse>,
	errorPrefix: string,
): ToolHandler<T> {
	return async (args: T, extra: any): Promise<ToolResponse> => {
		try {
			const result = await handler(args, extra);

			// If handler returns a string, wrap it in a ToolResponse
			if (typeof result === "string") {
				return {
					content: [{ type: "text", text: result }],
				};
			}

			return result;
		} catch (error: any) {
			const message = error?.message || String(error);
			return {
				content: [{ type: "text", text: `${errorPrefix}: ${message}` }],
				isError: true,
			};
		}
	};
}

/**
 * Create a safe tool registrar that automatically wraps handlers with error handling.
 * Use this when you want all tools registered through it to have automatic error handling.
 *
 * @param baseRegister - The underlying tool registrar
 * @returns A new registrar that wraps handlers with error handling
 */
export function createSafeToolRegistrar(
	baseRegister: ToolRegistrar,
): ToolRegistrar {
	return (name, schema, handler) => {
		const safeHandler: ToolHandler<any> = async (args, extra) => {
			try {
				return await handler(args, extra);
			} catch (error: any) {
				const message = error?.message || String(error);
				return {
					content: [{ type: "text", text: `Error in ${name}: ${message}` }],
					isError: true,
				};
			}
		};

		baseRegister(name, schema, safeHandler);
	};
}

/**
 * Helper to create a success response with text content.
 */
export function successResponse(text: string): ToolResponse {
	return {
		content: [{ type: "text", text }],
	};
}

/**
 * Helper to create an error response with text content.
 */
export function errorResponse(text: string): ToolResponse {
	return {
		content: [{ type: "text", text }],
		isError: true,
	};
}
