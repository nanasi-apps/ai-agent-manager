import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { getEnhancedEnv } from "../../utils/path-enhancer";

const execFileAsyncBase = promisify(execFile);

/**
 * Execute a file with enhanced PATH.
 */
export async function execFileAsync(
	command: string,
	args: string[],
	options: { cwd: string },
) {
	return execFileAsyncBase(command, args, {
		...options,
		env: getEnhancedEnv(),
	});
}

// Re-export for convenience
export { getEnhancedEnv } from "../../utils/path-enhancer";
