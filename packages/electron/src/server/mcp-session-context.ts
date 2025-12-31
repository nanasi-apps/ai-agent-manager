import { AsyncLocalStorage } from "node:async_hooks";

export type McpSessionContext = {
	sessionId: string;
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
