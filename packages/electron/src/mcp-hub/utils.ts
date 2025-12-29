import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { promisify } from "node:util";
import type {
	McpResourceContent,
	McpResourceUpdate,
} from "@agent-manager/shared";

const execFileAsync = promisify(execFile);

/**
 * Format stdout/stderr output, returning a clean combined string.
 * If both are empty, returns the fallback.
 */
export function formatOutput(
	stdout?: string,
	stderr?: string,
	emptyFallback = "OK",
): string {
	const cleanStdout = stdout?.trim();
	const cleanStderr = stderr?.trim();
	if (cleanStdout && cleanStderr) {
		return `${cleanStdout}
${cleanStderr}`;
	}
	if (cleanStdout) return cleanStdout;
	if (cleanStderr) return cleanStderr;
	return emptyFallback;
}

/**
 * Extract error message from an unknown error value.
 */
export function extractErrorMessage(error: unknown): string {
	if (error instanceof Error) {
		return error.message;
	}
	return String(error);
}

/**
 * Run a command and return the formatted output.
 */
export async function runCommand(
	cwd: string,
	command: string,
	args: string[],
): Promise<string> {
	const { stdout, stderr } = await execFileAsync(command, args, { cwd });
	return formatOutput(stdout?.toString(), stderr?.toString(), "");
}

/**
 * Run a git command in the specified directory.
 */
export async function runGit(cwd: string, args: string[]): Promise<string> {
	return runCommand(cwd, "git", args);
}

/**
 * Get the current branch name for a repository.
 */
export async function getCurrentBranch(repoPath: string): Promise<string> {
	const result = await runGit(repoPath, ["rev-parse", "--abbrev-ref", "HEAD"]);
	return result.trim();
}

/**
 * Create a polling subscription for resource updates.
 * Polls at the specified interval and calls onUpdate when content changes.
 */
export function createPollingSubscription(
	read: () => Promise<McpResourceContent>,
	onUpdate: (update: McpResourceUpdate) => void,
	intervalMs = 2000,
): () => void {
	let active = true;
	let lastHash = "";

	const poll = async () => {
		if (!active) return;
		const content = await read();
		const payload = content.text ?? content.blob ?? "";
		const hash = createHash("sha1").update(payload).digest("hex");
		if (hash !== lastHash) {
			lastHash = hash;
			onUpdate({ uri: content.uri, content });
		}
	};

	poll().catch((error) => {
		console.warn("[McpHub] Initial resource poll failed", error);
	});

	const timer = setInterval(() => {
		poll().catch((error) => {
			console.warn("[McpHub] Resource poll failed", error);
		});
	}, intervalMs);

	return () => {
		active = false;
		clearInterval(timer);
	};
}
