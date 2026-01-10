import { os } from "@orpc/server";
import { z } from "zod";
import { getRouterContext } from "./createRouter";

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
			const ctx = getRouterContext();
			if (!ctx.rulesService) return [];
			return ctx.rulesService.listGlobalRules();
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
			const ctx = getRouterContext();
			if (!ctx.rulesService) return null;
			const rule = await ctx.rulesService.getGlobalRule(input.id);
			if (!rule) return null;
			return {
				id: rule.id,
				name: rule.name,
				content: rule.content || "",
			};
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
			const ctx = getRouterContext();
			if (!ctx.rulesService) return { id: "", success: false };
			return ctx.rulesService.createGlobalRule(input.name, input.content);
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
			const ctx = getRouterContext();
			if (!ctx.rulesService) return { success: false };
			const success = await ctx.rulesService.updateGlobalRule(
				input.id,
				input.content,
			);
			return { success };
		}),

	deleteGlobalRule: os
		.input(z.object({ id: z.string() }))
		.output(z.object({ success: z.boolean() }))
		.handler(async ({ input }) => {
			const ctx = getRouterContext();
			if (!ctx.rulesService) return { success: false };
			const success = await ctx.rulesService.deleteGlobalRule(input.id);
			return { success };
		}),
};
