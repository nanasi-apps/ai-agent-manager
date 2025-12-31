import { execFile } from "node:child_process";
import { homedir } from "node:os";
import { promisify } from "node:util";
import * as path from "path";

const execFileAsyncBase = promisify(execFile);

/**
 * Get an enhanced environment with PATH that includes common binary locations.
 * This is needed because Electron on macOS doesn't inherit shell PATH.
 */
export function getEnhancedEnv(): NodeJS.ProcessEnv {
	if (process.platform !== "darwin") {
		return process.env;
	}

	const extraPaths = [
		"/opt/homebrew/bin", // Apple Silicon
		"/usr/local/bin", // Intel Mac
		path.join(homedir(), ".local", "bin"),
	];

	const currentPath = process.env.PATH || "";
	const pathsToAdd = extraPaths.filter((p) => !currentPath.includes(p));

	if (pathsToAdd.length === 0) {
		return process.env;
	}

	return {
		...process.env,
		PATH: [...pathsToAdd, currentPath].join(":"),
	};
}

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
