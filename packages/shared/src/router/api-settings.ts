import { os } from "@orpc/server";
import { z } from "zod";
import { getStoreOrThrow } from "../services/dependency-container";

export const apiSettingsRouter = {
	getApiSettings: os
		.output(
			z.object({
				openaiApiKey: z.string().optional(),
				openaiBaseUrl: z.string().optional(),
				geminiApiKey: z.string().optional(),
				geminiBaseUrl: z.string().optional(),
				language: z.string().optional(),
				notifyOnAgentComplete: z.boolean().optional(),
			}),
		)
		.handler(async () => {
			const settings = getStoreOrThrow().getApiSettings();
			// Mask API keys for security (return only existence, not full key)
			return {
				openaiApiKey: settings.openaiApiKey ? "***" : undefined,
				openaiBaseUrl: settings.openaiBaseUrl,
				geminiApiKey: settings.geminiApiKey ? "***" : undefined,
				geminiBaseUrl: settings.geminiBaseUrl,
				language: settings.language,
				notifyOnAgentComplete: settings.notifyOnAgentComplete,
			};
		}),

	updateApiSettings: os
		.input(
			z.object({
				openaiApiKey: z.string().optional(),
				openaiBaseUrl: z.string().optional(),
				geminiApiKey: z.string().optional(),
				geminiBaseUrl: z.string().optional(),
				language: z.string().optional(),
				notifyOnAgentComplete: z.boolean().optional(),
			}),
		)
		.output(z.object({ success: z.boolean() }))
		.handler(async ({ input }) => {
			const updates: {
				openaiApiKey?: string;
				openaiBaseUrl?: string;
				geminiApiKey?: string;
				geminiBaseUrl?: string;
				language?: string;
				notifyOnAgentComplete?: boolean;
			} = {};
			if (input.openaiApiKey !== undefined) {
				updates.openaiApiKey = input.openaiApiKey || undefined;
			}
			if (input.openaiBaseUrl !== undefined) {
				updates.openaiBaseUrl = input.openaiBaseUrl || undefined;
			}
			if (input.geminiApiKey !== undefined) {
				updates.geminiApiKey = input.geminiApiKey || undefined;
			}
			if (input.geminiBaseUrl !== undefined) {
				updates.geminiBaseUrl = input.geminiBaseUrl || undefined;
			}
			if (input.language !== undefined) {
				updates.language = input.language || undefined;
			}
			if (input.notifyOnAgentComplete !== undefined) {
				updates.notifyOnAgentComplete = input.notifyOnAgentComplete;
			}
			getStoreOrThrow().updateApiSettings(updates);
			return { success: true };
		}),
};
