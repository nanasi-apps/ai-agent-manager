import {
	mkdir,
	readdir,
	readFile,
	stat,
	unlink,
	writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { os } from "@orpc/server";
import { z } from "zod";
import { RULES_DIR } from "../services/rules-resolver";

export const rulesRouter = {
	listGlobalRules: os
		.output(
			z.array(
				z.object({
					id: z.string(),
					name: z.string(),
					content: z.string().optional(),
				}),
			),
		)
		.handler(async () => {
			await mkdir(RULES_DIR, { recursive: true });
			try {
				const files = await readdir(RULES_DIR);
				const rules = [];
				for (const file of files) {
					if (file.endsWith(".md")) {
						const filePath = join(RULES_DIR, file);
						const stats = await stat(filePath);
						if (stats.isFile()) {
							rules.push({
								id: file,
								name: file.replace(/\.md$/, ""),
							});
						}
					}
				}
				return rules;
			} catch (e) {
				return [];
			}
		}),

	getGlobalRule: os
		.input(z.object({ id: z.string() }))
		.output(
			z
				.object({
					id: z.string(),
					name: z.string(),
					content: z.string(),
				})
				.nullable(),
		)
		.handler(async ({ input }) => {
			const filePath = join(RULES_DIR, input.id);
			try {
				const content = await readFile(filePath, "utf-8");
				return {
					id: input.id,
					name: input.id.replace(/\.md$/, ""),
					content,
				};
			} catch (e) {
				return null;
			}
		}),

	createGlobalRule: os
		.input(
			z.object({
				name: z.string().min(1),
				content: z.string().default(""),
			}),
		)
		.output(
			z.object({
				id: z.string(),
				success: z.boolean(),
			}),
		)
		.handler(async ({ input }) => {
			const safeName = input.name.replace(/[^a-zA-Z0-9_-]/g, "_");
			const filename = `${safeName}.md`;
			const filePath = join(RULES_DIR, filename);
			await mkdir(RULES_DIR, { recursive: true });
			await writeFile(filePath, input.content, "utf-8");
			return { id: filename, success: true };
		}),

	updateGlobalRule: os
		.input(
			z.object({
				id: z.string(),
				content: z.string(),
			}),
		)
		.output(z.object({ success: z.boolean() }))
		.handler(async ({ input }) => {
			const filePath = join(RULES_DIR, input.id);
			await writeFile(filePath, input.content, "utf-8");
			return { success: true };
		}),

	deleteGlobalRule: os
		.input(z.object({ id: z.string() }))
		.output(z.object({ success: z.boolean() }))
		.handler(async ({ input }) => {
			const filePath = join(RULES_DIR, input.id);
			try {
				await unlink(filePath);
				return { success: true };
			} catch (e) {
				return { success: false };
			}
		}),
};
