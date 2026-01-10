import type { ApprovalChannel, AppSettings } from "@agent-manager/shared";
import { store } from "../infrastructure/store/file-store";

export class NotificationService {
	private async sendToSlack(
		webhookUrl: string,
		message: string,
	): Promise<void> {
		try {
			await fetch(webhookUrl, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ text: message }),
			});
		} catch (error) {
			console.error(
				"[NotificationService] Failed to send Slack notification",
				error,
			);
		}
	}

	private async sendToDiscord(
		webhookUrl: string,
		message: string,
	): Promise<void> {
		try {
			await fetch(webhookUrl, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ content: message }),
			});
		} catch (error) {
			console.error(
				"[NotificationService] Failed to send Discord notification",
				error,
			);
		}
	}

	public async notify(
		channels: ApprovalChannel[],
		message: string,
	): Promise<void> {
		const settings: AppSettings = store.getAppSettings();

		const tasks: Promise<void>[] = [];

		if (channels.includes("slack") && settings.slackWebhookUrl) {
			tasks.push(this.sendToSlack(settings.slackWebhookUrl, message));
		}

		if (channels.includes("discord") && settings.discordWebhookUrl) {
			tasks.push(this.sendToDiscord(settings.discordWebhookUrl, message));
		}

		await Promise.all(tasks);
	}
}

export const notificationService = new NotificationService();
