/**
 * Cross-platform UUID generation
 */
export function generateUUID(): string {
	// Use crypto.randomUUID if available (Node 19+, modern browsers)
	if (
		typeof crypto !== "undefined" &&
		typeof crypto.randomUUID === "function"
	) {
		return crypto.randomUUID();
	}
	// Fallback for older environments
	return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
		const r = (Math.random() * 16) | 0;
		const v = c === "x" ? r : (r & 0x3) | 0x8;
		return v.toString(16);
	});
}

/**
 * Timeout wrapper for async operations
 */
export function withTimeout<T>(
	promise: Promise<T>,
	timeoutMs: number,
	fallback: T,
): Promise<T> {
	return Promise.race([
		promise,
		new Promise<T>((resolve) => {
			setTimeout(() => {
				console.warn(
					`[withTimeout] Operation timed out after ${timeoutMs}ms, using fallback`,
				);
				resolve(fallback);
			}, timeoutMs);
		}),
	]);
}
