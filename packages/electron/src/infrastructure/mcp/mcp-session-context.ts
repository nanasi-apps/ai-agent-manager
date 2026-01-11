import { AsyncLocalStorage } from "node:async_hooks";

export type McpSessionContext = {
	sessionId: string;
	projectId: string;
	isSuperuser: boolean;
};

const mcpSessionContext = new AsyncLocalStorage<McpSessionContext>();

export function runWithSessionContext<T>(
	context: McpSessionContext,
	fn: () => T,
): T {
	return mcpSessionContext.run(context, fn);
}

export function getSessionContext(): McpSessionContext | undefined {
	return mcpSessionContext.getStore();
}

/**
 * Get the projectId from the current session context.
 * Returns undefined if no session context or conversation not found.
 */
export function getSessionProjectId(): string | undefined {
	const context = getSessionContext();
	return context?.projectId;
}
