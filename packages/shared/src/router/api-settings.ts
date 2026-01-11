import { os } from "@orpc/server";
import { z } from "zod";
import type { RouterContext } from "./createRouter";

const MASKED_API_KEY = "********************";

export function createApiSettingsRouter(ctx: RouterContext) {
	return {
	getApiSettings: os
		.output(
			z.object({
				providers: z.array(
					z.union([
						z.object({
							id: z.string(),
							name: z.string(),
							type: z.literal("gemini"),
							baseUrl: z.string().optional(),
							apiKey: z.string().optional(),
							disabledModels: z.array(z.string()).optional(),
						}),
						z.object({
							id: z.string(),
							name: z.string(),
							type: z.enum(["codex", "openai", "openai_compatible"]),
							baseUrl: z.string().optional(),
							apiKey: z.string().optional(),
							envKey: z.string().optional(),
							disabledModels: z.array(z.string()).optional(),
						}),
					]),
				),
			}),
		)
		.handler(async () => {
			const settings = ctx.store.getApiSettings();
			// Mask API keys for security
			const providers = (settings.providers || []).map((p) => {
				if (p.apiKey) {
					return { ...p, apiKey: MASKED_API_KEY };
				}
				return p;
			});
			return { providers };
		}),

	updateApiSettings: os
		.input(
			z.object({
				providers: z
					.array(
						z.union([
							z.object({
								id: z.string(),
								name: z.string(),
								type: z.literal("gemini"),
								baseUrl: z.string().optional(),
								apiKey: z.string().optional(),
								disabledModels: z.array(z.string()).optional(),
							}),
							z.object({
								id: z.string(),
								name: z.string(),
								type: z.enum(["codex", "openai", "openai_compatible"]),
								baseUrl: z.string().optional(),
								apiKey: z.string().optional(),
								envKey: z.string().optional(),
								disabledModels: z.array(z.string()).optional(),
							}),
						]),
					)
					.optional(),
			}),
		)
		.output(z.object({ success: z.boolean() }))
		.handler(async ({ input }) => {
			if (input.providers) {
				const existingSettings = ctx.store.getApiSettings();
				const existingProviders = existingSettings.providers || [];

				const resolvedProviders = input.providers.map((p) => {
					// If apiKey is masked, try to find existing key
					if (p.apiKey === MASKED_API_KEY) {
						const existing = existingProviders.find((ep) => ep.id === p.id);
						if (existing?.apiKey) {
							return { ...p, apiKey: existing.apiKey };
						}
						return p;
					}
					return p;
				});

				ctx.store.updateApiSettings({ providers: resolvedProviders });
			}
			// Clear the model cache when API settings change
			ctx.modelFetcher?.clearCache();
			return { success: true };
		}),
	};
}
