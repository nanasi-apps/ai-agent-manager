import type { ChildProcess } from "node:child_process";

/**
 * Kill a process and its process group.
 */
export function killProcessGroup(pid: number): void {
	try {
		// Kill the entire process group
		process.kill(-pid, "SIGKILL");
	} catch {
		// Fallback - just kill the process itself
		try {
			process.kill(pid, "SIGKILL");
		} catch {
			// Process may have already exited
		}
	}
}

/**
 * Kill a child process safely.
 */
export function killChildProcess(childProcess: ChildProcess | undefined): void {
	if (childProcess?.pid) {
		killProcessGroup(childProcess.pid);
	}
}

/**
 * Setup stdout handler for a child process.
 */
export function setupStdoutHandler(
	child: ChildProcess,
	onData: (data: string) => void,
): void {
	if (child.stdout) {
		child.stdout.on("data", (data: Buffer) => {
			onData(data.toString());
		});
	}
}

/**
 * Setup stderr handler for a child process.
 */
export function setupStderrHandler(
	child: ChildProcess,
	onData: (data: string) => void,
): void {
	if (child.stderr) {
		child.stderr.on("data", (data: Buffer) => {
			onData(data.toString());
		});
	}
}

/**
 * Error patterns that indicate session invalidation.
 */
export const SESSION_INVALID_PATTERNS = [
	"Invalid session identifier",
	"No previous sessions found",
] as const;

/**
 * Error patterns for Gemini API issues.
 */
export const GEMINI_API_ERROR_PATTERN = "Error when talking to Gemini API";
export const GEMINI_QUOTA_PATTERN =
	/Your quota will reset after (\d+h\d+m\d+s|\d+m\d+s|\d+s)/;
export const GEMINI_CAPACITY_PATTERN = "exhausted your capacity";

/**
 * Check if stderr indicates a session invalidation error.
 */
export function isSessionInvalidError(stderr: string): boolean {
	return SESSION_INVALID_PATTERNS.some((pattern) => stderr.includes(pattern));
}

/**
 * Check if stderr indicates a Gemini API error.
 */
export function isGeminiApiError(stderr: string): boolean {
	return stderr.includes(GEMINI_API_ERROR_PATTERN);
}

/**
 * Parse quota reset time from stderr.
 */
export function parseQuotaResetTime(stderr: string): string | null {
	const match = stderr.match(GEMINI_QUOTA_PATTERN);
	return match ? match[1] : null;
}

/**
 * Check if the error is a quota exhaustion error.
 */
export function isQuotaError(stderr: string): boolean {
	return (
		stderr.includes(GEMINI_CAPACITY_PATTERN) ||
		GEMINI_QUOTA_PATTERN.test(stderr)
	);
}
