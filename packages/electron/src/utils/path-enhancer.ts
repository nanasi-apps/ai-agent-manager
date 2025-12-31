import { execSync } from "node:child_process";
import { homedir } from "node:os";
import * as path from "node:path";

/**
 * Extra paths to include for macOS.
 * These paths are commonly used by Homebrew and local user binaries.
 */
export const EXTRA_PATH_DIRS = [
	"/opt/homebrew/bin", // Apple Silicon
	"/usr/local/bin", // Intel Mac
	path.join(homedir(), ".local", "bin"),
] as const;

/**
 * Get an enhanced environment with PATH that includes common binary locations.
 * This is needed because Electron on macOS doesn't inherit shell PATH.
 */
export function getEnhancedEnv(): NodeJS.ProcessEnv {
	if (process.platform !== "darwin") {
		return process.env;
	}

	const currentPath = process.env.PATH || "";
	const pathsToAdd = EXTRA_PATH_DIRS.filter((p) => !currentPath.includes(p));

	if (pathsToAdd.length === 0) {
		return process.env;
	}

	return {
		...process.env,
		PATH: [...pathsToAdd, currentPath].join(":"),
	};
}

/**
 * Fix the global process.env.PATH for macOS GUI apps.
 * This ensures git and other CLI tools are found.
 * Should be called early in application startup.
 */
export function fixProcessPath(): void {
	if (process.platform !== "darwin") return;

	try {
		// Get the PATH from the user's default shell
		const shell = process.env.SHELL || "/bin/zsh";
		const shellPath = execSync(`${shell} -ilc 'echo $PATH'`, {
			encoding: "utf-8",
			timeout: 5000,
		}).trim();

		if (shellPath && shellPath !== process.env.PATH) {
			process.env.PATH = shellPath;
			console.log("[PathEnhancer] Fixed PATH from shell");
		}
	} catch (error) {
		console.warn("[PathEnhancer] Failed to get PATH from shell:", error);
	}

	// Fallback: ensure common bin paths are included
	for (const binPath of EXTRA_PATH_DIRS) {
		if (!process.env.PATH?.includes(binPath)) {
			process.env.PATH = `${binPath}:${process.env.PATH}`;
			console.log(`[PathEnhancer] Added ${binPath} to PATH`);
		}
	}
}
