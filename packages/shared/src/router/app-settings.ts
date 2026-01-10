import { os } from "@orpc/server";
import { z } from "zod";
import type { AppSettings } from "../types/store";
import { getRouterContext } from "./createRouter";

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
				webServerAutoStart: z.boolean().optional(),
				webServerAutoOpenBrowser: z.boolean().optional(),
				webServerHost: z.string().optional(),
				webServerPort: z.number().optional(),
			}),
		)
		.handler(async () => {
			const ctx = getRouterContext();
			const settings = ctx.store.getAppSettings();
			return {
				language: settings.language,
				notifyOnAgentComplete: settings.notifyOnAgentComplete,
				approvalNotificationChannels: settings.approvalNotificationChannels,
				newConversionOpenMode: settings.newConversionOpenMode,
				webServerAutoStart: settings.webServerAutoStart,
				webServerAutoOpenBrowser: settings.webServerAutoOpenBrowser,
				webServerHost: settings.webServerHost,
				webServerPort: settings.webServerPort,
			};
		}),

	updateAppSettings: os
		.input(
			z.object({
				language: z.string().optional(),
				notifyOnAgentComplete: z.boolean().optional(),
				approvalNotificationChannels: z.array(approvalChannelSchema).optional(),
				newConversionOpenMode: z.enum(["page", "dialog"]).optional(),
				webServerAutoStart: z.boolean().optional(),
				webServerAutoOpenBrowser: z.boolean().optional(),
				webServerHost: z.string().optional(),
				webServerPort: z.number().optional(),
			}),
		)
		.output(z.object({ success: z.boolean() }))
		.handler(async ({ input }) => {
			const ctx = getRouterContext();
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
			if (input.webServerAutoStart !== undefined) {
				updates.webServerAutoStart = input.webServerAutoStart;
			}
			if (input.webServerAutoOpenBrowser !== undefined) {
				updates.webServerAutoOpenBrowser = input.webServerAutoOpenBrowser;
			}
			if (input.webServerHost !== undefined) {
				updates.webServerHost = input.webServerHost || undefined;
			}
			if (input.webServerPort !== undefined) {
				updates.webServerPort = input.webServerPort;
			}
			ctx.store.updateAppSettings(updates);
			return { success: true };
		}),
};
