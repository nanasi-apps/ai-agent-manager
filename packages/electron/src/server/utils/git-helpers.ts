import { execFileAsync } from "./exec-helpers";

export async function getCurrentBranch(repoPath: string): Promise<string> {
	const { stdout } = await execFileAsync(
		"git",
		["rev-parse", "--abbrev-ref", "HEAD"],
		{ cwd: repoPath },
	);
	return stdout.trim();
}

export async function getConflictedFiles(repoPath: string): Promise<string[]> {
	try {
		const { stdout } = await execFileAsync(
			"git",
			["diff", "--name-only", "--diff-filter=U"],
			{ cwd: repoPath },
		);
		return stdout
			.trim()
			.split("\n")
			.filter((s) => s);
	} catch (e) {
		return [];
	}
}

export async function runGit(
	repoPath: string,
	args: string[],
): Promise<string> {
	try {
		const { stdout, stderr } = await execFileAsync("git", args, {
			cwd: repoPath,
		});
		const out = stdout?.toString().trimEnd();
		const err = stderr?.toString().trimEnd();
		if (out && err) return `${out}\n${err}`;
		if (out) return out;
		if (err) return err;
		return "OK";
	} catch (error: any) {
		const stdout = error?.stdout?.toString();
		const stderr = error?.stderr?.toString();
		const out = stdout?.trim();
		const err = stderr?.trim();
		const message = out || err || error?.message || String(error);
		throw new Error(message);
	}
}

export async function runGtr(
	repoPath: string,
	args: string[],
): Promise<string> {
	try {
		const { stdout, stderr } = await execFileAsync("git", ["gtr", ...args], {
			cwd: repoPath,
		});
		const out = stdout?.toString().trim();
		const err = stderr?.toString().trim();
		if (out && err) return `${out}\n${err}`;
		if (out) return out;
		if (err) return err;
		return "OK";
	} catch (error: any) {
		const stdout = error?.stdout?.toString();
		const stderr = error?.stderr?.toString();
		const out = stdout?.trim();
		const err = stderr?.trim();
		const message = out || err || error?.message || String(error);
		if (message.includes("is not a git command")) {
			throw new Error(
				"git gtr is not installed. Install git-worktree-runner (https://github.com/coderabbitai/git-worktree-runner).",
			);
		}
		throw new Error(message);
	}
}
