import { os } from "@orpc/server";
import { z } from "zod";
import { getStoreOrThrow } from "../services/dependency-container";
import type { AppSettings } from "../types/store";

const approvalChannels = ["inbox", "slack", "discord"] as const;
const approvalChannelSchema = z.enum(approvalChannels);

export const appSettingsRouter = {
	getAppSettings: os
		.output(
			z.object({
				language: z.string().optional(),
				notifyOnAgentComplete: z.boolean().optional(),
				approvalNotificationChannels: z.array(approvalChannelSchema).optional(),
				newConversionOpenMode: z.enum(["page", "dialog"]).optional(),
			}),
		)
		.handler(async () => {
			const settings = getStoreOrThrow().getAppSettings();
			return {
				language: settings.language,
				notifyOnAgentComplete: settings.notifyOnAgentComplete,
				approvalNotificationChannels: settings.approvalNotificationChannels,
				newConversionOpenMode: settings.newConversionOpenMode,
			};
		}),

	updateAppSettings: os
		.input(
			z.object({
				language: z.string().optional(),
				notifyOnAgentComplete: z.boolean().optional(),
				approvalNotificationChannels: z.array(approvalChannelSchema).optional(),
				newConversionOpenMode: z.enum(["page", "dialog"]).optional(),
			}),
		)
		.output(z.object({ success: z.boolean() }))
		.handler(async ({ input }) => {
			const updates: Partial<AppSettings> = {};
			if (input.language !== undefined) {
				updates.language = input.language || undefined;
			}
			if (input.notifyOnAgentComplete !== undefined) {
				updates.notifyOnAgentComplete = input.notifyOnAgentComplete;
			}
			if (input.approvalNotificationChannels !== undefined) {
				updates.approvalNotificationChannels =
					input.approvalNotificationChannels;
			}
			if (input.newConversionOpenMode !== undefined) {
				updates.newConversionOpenMode = input.newConversionOpenMode;
			}
			getStoreOrThrow().updateAppSettings(updates);
			return { success: true };
		}),
};
