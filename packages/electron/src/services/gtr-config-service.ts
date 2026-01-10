import type { GtrConfig, IGtrConfigService } from "@agent-manager/shared";
import { runGit } from "../infrastructure/mcp/utils";

export class GtrConfigService implements IGtrConfigService {
	async getGtrConfig(rootPath: string): Promise<GtrConfig> {
		const getConfigList = async (key: string): Promise<string[]> => {
			try {
				const output = await runGit(rootPath, [
					"config",
					"-f",
					".gtrconfig",
					"--get-all",
					key,
				]);
				return output
					.split("\n")
					.map((s) => s.trim())
					.filter((s) => s);
			} catch (e) {
				// git config returns 1 if key not found
				return [];
			}
		};

		const [include, exclude, includeDirs, excludeDirs, postCreate] =
			await Promise.all([
				getConfigList("copy.include"),
				getConfigList("copy.exclude"),
				getConfigList("copy.includeDirs"),
				getConfigList("copy.excludeDirs"),
				getConfigList("hooks.postCreate"),
			]);

		return {
			copy: {
				include,
				exclude,
				includeDirs,
				excludeDirs,
			},
			hooks: {
				postCreate,
			},
		};
	}

	async updateGtrConfig(rootPath: string, config: GtrConfig): Promise<void> {
		const setConfigList = async (key: string, values: string[]) => {
			// Unset all existing values for the key
			try {
				await runGit(rootPath, [
					"config",
					"-f",
					".gtrconfig",
					"--unset-all",
					key,
				]);
			} catch (e) {
				// Ignore error if key doesn't exist
			}

			// Add new values
			for (const value of values) {
				if (!value.trim()) continue;
				await runGit(rootPath, [
					"config",
					"-f",
					".gtrconfig",
					"--add",
					key,
					value,
				]);
			}
		};

		// Run sequentially to avoid file locking issues
		await setConfigList("copy.include", config.copy.include);
		await setConfigList("copy.exclude", config.copy.exclude);
		await setConfigList("copy.includeDirs", config.copy.includeDirs);
		await setConfigList("copy.excludeDirs", config.copy.excludeDirs);
		await setConfigList("hooks.postCreate", config.hooks.postCreate);
	}
}
