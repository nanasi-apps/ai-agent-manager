import { randomUUID } from "node:crypto";
import type {
	AgentStatePayload,
	AgentStateValue,
	ApprovalChannel,
} from "@agent-manager/shared";
import { BrowserWindow, Notification } from "electron";
import { unifiedAgentManager } from "../agents";
import { notificationService } from "../services/notification-service";
import { store } from "../store/file-store";
import { publishAgentState } from "./agent-state-port";

const lastStateBySession = new Map<string, AgentStateValue>();
const approvalChannelSet = new Set<ApprovalChannel>([
	"inbox",
	"slack",
	"discord",
]);

function generateFallbackUUID(): string {
	return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
		const r = (Math.random() * 16) | 0;
		const v = c === "x" ? r : (r & 0x3) | 0x8;
		return v.toString(16);
	});
}

function generateId(): string {
	try {
		return randomUUID();
	} catch {
		return generateFallbackUUID();
	}
}

function generatePlanSummary(planContent: string): string {
	const clean = planContent
		.replace(/^#+\s*/gm, "")
		.replace(/\n+/g, " ")
		.trim();
	if (clean.length <= 200) return clean;
	return `${clean.slice(0, 200)}...`;
}

function resolveNotificationChannels(
	configuredChannels: ApprovalChannel[] | undefined,
): ApprovalChannel[] {
	const unique = new Set<ApprovalChannel>(["inbox"]);
	for (const channel of configuredChannels ?? []) {
		if (approvalChannelSet.has(channel)) {
			unique.add(channel);
		}
	}
	return Array.from(unique);
}

function getLatestPlanMessage(
	sessionId: string,
): { content: string; timestamp: number } | null {
	const messages = store.getMessages(sessionId);

	for (let i = messages.length - 1; i >= 0; i--) {
		const msg = messages[i];
		if (
			msg?.role === "agent" &&
			msg.logType === "plan" &&
			msg.content?.trim()
		) {
			return { content: msg.content, timestamp: msg.timestamp };
		}
	}

	return null;
}

function hasMatchingApproval(
	sessionId: string,
	planMessage: { content: string; timestamp: number },
): boolean {
	const trimmed = planMessage.content.trim();
	if (!trimmed) return false;
	return store
		.listApprovals()
		.some(
			(approval) =>
				approval.sessionId === sessionId &&
				approval.planContent.trim() === trimmed &&
				approval.createdAt >= planMessage.timestamp,
		);
}

function matchesState(
	value: AgentStateValue | undefined,
	state: string,
): boolean {
	if (!value) return false;
	if (typeof value === "string") return value === state;
	return Object.hasOwn(value, state);
}

function shouldNotifyOnComplete(
	currentValue: AgentStateValue,
	previousValue: AgentStateValue | undefined,
	context: Record<string, unknown>,
): boolean {
	const transitionedToIdle =
		matchesState(previousValue, "processing") &&
		matchesState(currentValue, "idle");
	if (!transitionedToIdle) return false;
	if ((context as { pendingWorktreeResume?: unknown })?.pendingWorktreeResume) {
		return false;
	}
	const notifyEnabled = store.getAppSettings().notifyOnAgentComplete ?? true;

	return notifyEnabled && Notification.isSupported();
}

function sendCompletionNotification(sessionId: string) {
	const conversation = store.getConversation(sessionId);
	const project = conversation?.projectId
		? store.getProject(conversation.projectId)
		: undefined;

	const title = "Agent completed";
	const bodyParts: string[] = [];
	if (conversation?.title) bodyParts.push(conversation.title);
	if (project?.name) bodyParts.push(project.name);
	const body = bodyParts.length > 0 ? bodyParts.join(" • ") : sessionId;
	console.log(
		`[AgentState] Sending completion notification for ${sessionId}: ${body}`,
	);
	new Notification({ title, body, silent: false }).show();
}

export function setupAgentState() {
	unifiedAgentManager.on(
		"state-changed",
		(payload: AgentStatePayload & { persistedState?: unknown }) => {
			const persistedState = payload.persistedState;
			const context = payload.context;
			const config = (context as { config?: { cwd?: unknown } })?.config;
			const cwd = typeof config?.cwd === "string" ? config.cwd : undefined;
			const previousValue = lastStateBySession.get(payload.sessionId);
			lastStateBySession.set(payload.sessionId, payload.value);

			if (persistedState !== undefined) {
				store.updateConversation(payload.sessionId, {
					agentState: persistedState,
					...(cwd ? { cwd } : {}),
				});
			} else if (cwd) {
				store.updateConversation(payload.sessionId, { cwd });
			}

			const ipcPayload: AgentStatePayload = {
				sessionId: payload.sessionId,
				value: payload.value,
				context: payload.context,
			};

			const didComplete =
				matchesState(previousValue, "processing") &&
				matchesState(payload.value, "idle");

			if (didComplete) {
				const conversation = store.getConversation(payload.sessionId);
				if (conversation?.agentMode === "plan") {
					const planMessage = getLatestPlanMessage(payload.sessionId);

					if (
						planMessage &&
						!hasMatchingApproval(payload.sessionId, planMessage)
					) {
						const now = Date.now();
						const summary = generatePlanSummary(planMessage.content);
						const notificationChannels = resolveNotificationChannels(
							store.getAppSettings().approvalNotificationChannels,
						);

						store.addApproval({
							id: generateId(),
							sessionId: payload.sessionId,
							projectId: conversation.projectId || "",
							planContent: planMessage.content,
							planSummary: summary,
							status: "pending",
							channel: "inbox",
							notificationChannels,
							createdAt: now,
							updatedAt: now,
						});

						store.addMessage(payload.sessionId, {
							id: generateId(),
							role: "system",
							content: "Plan sent to Inbox for approval.",
							timestamp: now,
							logType: "system",
						});

						// Send notifications
						const project = conversation.projectId
							? store.getProject(conversation.projectId)
							: undefined;
						const message = `📋 **New Approval Request**\n\nProject: ${project?.name || "Unknown"}\n\nSummary: ${summary}`;
						notificationService.notify(notificationChannels, message);
					}
				}
			}

			if (
				shouldNotifyOnComplete(payload.value, previousValue, payload.context)
			) {
				console.log(
					`[AgentState] Sending completion notification for ${payload.sessionId}`,
				);
				sendCompletionNotification(payload.sessionId);
			}

			publishAgentState(ipcPayload);

			BrowserWindow.getAllWindows().forEach((win) => {
				win.webContents.send("agent:state-changed", ipcPayload);
			});
		},
	);
}
