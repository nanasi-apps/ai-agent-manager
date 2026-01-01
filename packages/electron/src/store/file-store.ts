import * as fs from "node:fs";
import * as path from "node:path";
import type {
	AppSettings,
	ApiSettings,
	ApprovalChannel,
	ApprovalRequest,
	ApprovalStatus,
	Conversation,
	IStore,
	Message,
	Project,
	ResourceLock,
} from "@agent-manager/shared";
import {
	normalizeMessages,
	type StoreData,
	tryMergeMessage,
} from "./serialization";

const approvalChannelSet = new Set<ApprovalChannel>([
	"inbox",
	"slack",
	"discord",
]);

const isApprovalChannel = (value: unknown): value is ApprovalChannel =>
	typeof value === "string" && approvalChannelSet.has(value as ApprovalChannel);

/**
 * File-based persistent store
 * Uses Electron's userData path for persistence
 */
export class FileStore implements IStore {
	private conversations: Map<string, Conversation> = new Map();
	private projects: Map<string, Project> = new Map();
	private locks: Map<string, ResourceLock> = new Map();
	private approvals: Map<string, ApprovalRequest> = new Map();
	private apiSettings: ApiSettings = {};
	private appSettings: AppSettings = {};
	private dataPath: string | null = null;
	private saveTimeout: ReturnType<typeof setTimeout> | null = null;

	setDataPath(dirPath: string) {
		this.dataPath = path.join(dirPath, "conversations.json");
		this.load();
	}

	private load() {
		if (!this.dataPath) return;

		try {
			if (fs.existsSync(this.dataPath)) {
				const raw = fs.readFileSync(this.dataPath, "utf-8");
				const data: StoreData = JSON.parse(raw);
				this.conversations.clear();

				for (const conv of data.conversations) {
					// Normalize existing messages by merging fragments
					if (conv.messages) {
						conv.messages = normalizeMessages(conv.messages);
					} else {
						conv.messages = [];
					}

					this.conversations.set(conv.id, conv);
				}

				if (data.projects) {
					this.projects.clear();
					for (const proj of data.projects) {
						this.projects.set(proj.id, proj);
					}
				}

				if (data.locks) {
					this.locks.clear();
					const now = Date.now();
					for (const lock of data.locks) {
						// Filter out expired locks on load
						if (lock.expiresAt && lock.expiresAt < now) {
							continue;
						}
						this.locks.set(lock.resourceId, lock);
					}
				}

				if (data.apiSettings) {
					const { openaiApiKey, openaiBaseUrl, geminiApiKey, geminiBaseUrl } =
						data.apiSettings;
					this.apiSettings = {
						openaiApiKey,
						openaiBaseUrl,
						geminiApiKey,
						geminiBaseUrl,
					};
				}

				if (data.appSettings) {
					this.appSettings = data.appSettings;
				}

				const legacyAppSettings = data.apiSettings as
					| (ApiSettings & Partial<AppSettings>)
					| undefined;
				const migratedSettings: Partial<AppSettings> = {};
				if (
					this.appSettings.language === undefined &&
					typeof legacyAppSettings?.language === "string"
				) {
					migratedSettings.language = legacyAppSettings.language;
				}
				if (
					this.appSettings.notifyOnAgentComplete === undefined &&
					typeof legacyAppSettings?.notifyOnAgentComplete === "boolean"
				) {
					migratedSettings.notifyOnAgentComplete =
						legacyAppSettings.notifyOnAgentComplete;
				}
				if (
					this.appSettings.approvalNotificationChannels === undefined &&
					Array.isArray(legacyAppSettings?.approvalNotificationChannels)
				) {
					migratedSettings.approvalNotificationChannels =
						legacyAppSettings.approvalNotificationChannels.filter(
							isApprovalChannel,
						);
				}
				if (Object.keys(migratedSettings).length > 0) {
					this.appSettings = { ...this.appSettings, ...migratedSettings };
				}

				if (data.approvals) {
					this.approvals.clear();
					for (const approval of data.approvals) {
						this.approvals.set(approval.id, approval);
					}
				}

				console.log(
					`[FileStore] Loaded ${this.conversations.size} conversations, ${this.projects.size} projects, ${this.locks.size} locks, and ${this.approvals.size} approvals from ${this.dataPath}`,
				);
				this.scheduleSave();
			}
		} catch (err) {
			console.error("[FileStore] Failed to load data:", err);
		}
	}

	private scheduleSave() {
		if (!this.dataPath) return;

		if (this.saveTimeout) {
			clearTimeout(this.saveTimeout);
		}
		this.saveTimeout = setTimeout(() => {
			this.saveSync();
		}, 500);
	}

	private saveSync() {
		if (!this.dataPath) return;

		try {
			const dir = path.dirname(this.dataPath);
			if (!fs.existsSync(dir)) {
				fs.mkdirSync(dir, { recursive: true });
			}

			const data: StoreData = {
				conversations: Array.from(this.conversations.values()),
				projects: Array.from(this.projects.values()),
				locks: Array.from(this.locks.values()),
				approvals: Array.from(this.approvals.values()),
				apiSettings: this.apiSettings,
				appSettings: this.appSettings,
			};
			fs.writeFileSync(this.dataPath, JSON.stringify(data, null, 2), "utf-8");
			console.log(
				`[FileStore] Saved ${this.conversations.size} conversations to ${this.dataPath}`,
			);
		} catch (err) {
			console.error("[FileStore] Failed to save data:", err);
		}
	}

	addConversation(conversation: Conversation) {
		this.conversations.set(conversation.id, conversation);
		this.scheduleSave();
	}

	getConversation(id: string): Conversation | undefined {
		return this.conversations.get(id);
	}

	listConversations(projectId?: string): Conversation[] {
		const all = Array.from(this.conversations.values()).sort(
			(a, b) => b.updatedAt - a.updatedAt,
		);
		if (projectId) {
			return all.filter((c) => c.projectId === projectId);
		}
		return all;
	}

	updateConversation(id: string, updates: Partial<Conversation>) {
		const existing = this.conversations.get(id);
		if (existing) {
			this.conversations.set(id, {
				...existing,
				...updates,
				updatedAt: Date.now(),
			});
			this.scheduleSave();
		}
	}

	addMessage(conversationId: string, message: Message) {
		const conv = this.conversations.get(conversationId);
		if (conv) {
			const lastMsg = conv.messages[conv.messages.length - 1];

			// Try to merge with the last message if compatible
			const merged = tryMergeMessage(lastMsg, message);

			if (!merged) {
				conv.messages.push(message);
			}

			conv.updatedAt = Date.now();
			this.scheduleSave();
		}
	}

	getMessages(conversationId: string): Message[] {
		const conv = this.conversations.get(conversationId);
		return conv?.messages || [];
	}

	deleteConversation(id: string) {
		this.conversations.delete(id);
		this.scheduleSave();
	}

	addProject(project: Project) {
		this.projects.set(project.id, project);
		this.scheduleSave();
	}

	getProject(id: string): Project | undefined {
		return this.projects.get(id);
	}

	listProjects(): Project[] {
		return Array.from(this.projects.values()).sort(
			(a, b) => b.updatedAt - a.updatedAt,
		);
	}

	updateProject(id: string, updates: Partial<Project>) {
		const existing = this.projects.get(id);
		if (existing) {
			this.projects.set(id, {
				...existing,
				...updates,
				updatedAt: Date.now(),
			});
			this.scheduleSave();
		}
	}

	deleteProject(id: string) {
		this.projects.delete(id);
		this.scheduleSave();
	}

	// Lock methods
	acquireLock(lock: ResourceLock): boolean {
		const existing = this.locks.get(lock.resourceId);
		const now = Date.now();

		// Check if existing lock is expired
		if (existing && existing.expiresAt && existing.expiresAt < now) {
			this.locks.delete(lock.resourceId);
			// Proceed to acquire
		} else if (existing) {
			// Already locked by someone else (or same agent)
			if (existing.agentId === lock.agentId) {
				// Refresh lock
				this.locks.set(lock.resourceId, { ...lock, timestamp: now });
				this.scheduleSave();
				return true;
			}
			return false;
		}

		this.locks.set(lock.resourceId, lock);
		this.scheduleSave();
		return true;
	}

	releaseLock(resourceId: string, agentId: string): boolean {
		const existing = this.locks.get(resourceId);
		if (existing && existing.agentId === agentId) {
			this.locks.delete(resourceId);
			this.scheduleSave();
			return true;
		}
		return false;
	}

	getLock(resourceId: string): ResourceLock | undefined {
		const existing = this.locks.get(resourceId);
		if (existing && existing.expiresAt && existing.expiresAt < Date.now()) {
			this.locks.delete(resourceId);
			this.scheduleSave();
			return undefined;
		}
		return existing;
	}

	listLocks(): ResourceLock[] {
		const now = Date.now();
		const active: ResourceLock[] = [];
		let changed = false;

		for (const [key, lock] of this.locks) {
			if (lock.expiresAt && lock.expiresAt < now) {
				this.locks.delete(key);
				changed = true;
			} else {
				active.push(lock);
			}
		}

		if (changed) {
			this.scheduleSave();
		}
		return active;
	}

	forceReleaseLock(resourceId: string): void {
		if (this.locks.has(resourceId)) {
			this.locks.delete(resourceId);
			this.scheduleSave();
		}
	}

	// API settings methods
	getApiSettings(): ApiSettings {
		return { ...this.apiSettings };
	}

	updateApiSettings(settings: Partial<ApiSettings>): void {
		this.apiSettings = { ...this.apiSettings, ...settings };
		this.scheduleSave();
	}

	// App settings methods
	getAppSettings(): AppSettings {
		return { ...this.appSettings };
	}

	updateAppSettings(settings: Partial<AppSettings>): void {
		this.appSettings = { ...this.appSettings, ...settings };
		this.scheduleSave();
	}

	// Approval methods
	addApproval(approval: ApprovalRequest): void {
		this.approvals.set(approval.id, approval);
		this.scheduleSave();
	}

	getApproval(id: string): ApprovalRequest | undefined {
		return this.approvals.get(id);
	}

	listApprovals(status?: ApprovalStatus): ApprovalRequest[] {
		const all = Array.from(this.approvals.values()).sort(
			(a, b) => b.createdAt - a.createdAt,
		);
		if (status) {
			return all.filter((a) => a.status === status);
		}
		return all;
	}

	updateApproval(id: string, updates: Partial<ApprovalRequest>): void {
		const existing = this.approvals.get(id);
		if (existing) {
			this.approvals.set(id, {
				...existing,
				...updates,
				updatedAt: Date.now(),
			});
			this.scheduleSave();
		}
	}

	deleteApproval(id: string): void {
		this.approvals.delete(id);
		this.scheduleSave();
	}
}

export const store = new FileStore();
