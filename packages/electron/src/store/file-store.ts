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
	private dataDir: string | null = null;
	private conversationsPath: string | null = null;
	private projectsPath: string | null = null;
	private locksPath: string | null = null;
	private approvalsPath: string | null = null;
	private settingsPath: string | null = null;
	private saveTimeout: ReturnType<typeof setTimeout> | null = null;

	setDataPath(dirPath: string) {
		this.dataDir = dirPath;
		this.conversationsPath = path.join(dirPath, "conversations.json");
		this.projectsPath = path.join(dirPath, "projects.json");
		this.locksPath = path.join(dirPath, "locks.json");
		this.approvalsPath = path.join(dirPath, "approvals.json");
		this.settingsPath = path.join(dirPath, "settings.json");
		this.load();
	}

	private load() {
		if (!this.dataDir) return;

		try {
			const {
				conversationsPath,
				projectsPath,
				locksPath,
				approvalsPath,
				settingsPath,
			} = this;
			if (!conversationsPath) return;

			this.conversations.clear();
			this.projects.clear();
			this.locks.clear();
			this.approvals.clear();
			this.apiSettings = {};
			this.appSettings = {};

			let loadedLegacy = false;

			if (fs.existsSync(conversationsPath)) {
				const raw = fs.readFileSync(conversationsPath, "utf-8");
				const data: unknown = JSON.parse(raw);

				if (
					data &&
					typeof data === "object" &&
					"conversations" in data
				) {
					const legacy = data as StoreData;
					for (const conv of legacy.conversations) {
						// Normalize existing messages by merging fragments
						if (conv.messages) {
							conv.messages = normalizeMessages(conv.messages);
						} else {
							conv.messages = [];
						}

						this.conversations.set(conv.id, conv);
					}

					if (legacy.projects) {
						for (const proj of legacy.projects) {
							this.projects.set(proj.id, proj);
						}
					}

					if (legacy.locks) {
						const now = Date.now();
						for (const lock of legacy.locks) {
							// Filter out expired locks on load
							if (lock.expiresAt && lock.expiresAt < now) {
								continue;
							}
							this.locks.set(lock.resourceId, lock);
						}
					}

					if (legacy.apiSettings) {
						const {
							openaiApiKey,
							openaiBaseUrl,
							geminiApiKey,
							geminiBaseUrl,
						} = legacy.apiSettings;
						this.apiSettings = {
							openaiApiKey,
							openaiBaseUrl,
							geminiApiKey,
							geminiBaseUrl,
						};
					}

					if (legacy.appSettings) {
						this.appSettings = legacy.appSettings;
					}

					const legacyAppSettings = legacy.apiSettings as
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

					if (legacy.approvals) {
						for (const approval of legacy.approvals) {
							this.approvals.set(approval.id, approval);
						}
					}

					loadedLegacy = true;
				} else if (Array.isArray(data)) {
					for (const conv of data as Conversation[]) {
						// Normalize existing messages by merging fragments
						if (conv.messages) {
							conv.messages = normalizeMessages(conv.messages);
						} else {
							conv.messages = [];
						}

						this.conversations.set(conv.id, conv);
					}
				}
			}

			if (!loadedLegacy) {
				if (projectsPath && fs.existsSync(projectsPath)) {
					const projects = JSON.parse(
						fs.readFileSync(projectsPath, "utf-8"),
					) as Project[];
					for (const proj of projects) {
						this.projects.set(proj.id, proj);
					}
				}

				if (locksPath && fs.existsSync(locksPath)) {
					const locks = JSON.parse(
						fs.readFileSync(locksPath, "utf-8"),
					) as ResourceLock[];
					const now = Date.now();
					for (const lock of locks) {
						if (lock.expiresAt && lock.expiresAt < now) {
							continue;
						}
						this.locks.set(lock.resourceId, lock);
					}
				}

				if (approvalsPath && fs.existsSync(approvalsPath)) {
					const approvals = JSON.parse(
						fs.readFileSync(approvalsPath, "utf-8"),
					) as ApprovalRequest[];
					for (const approval of approvals) {
						this.approvals.set(approval.id, approval);
					}
				}

				if (settingsPath && fs.existsSync(settingsPath)) {
					const settings = JSON.parse(
						fs.readFileSync(settingsPath, "utf-8"),
					) as { apiSettings?: ApiSettings; appSettings?: AppSettings };
					if (settings.apiSettings) {
						const {
							openaiApiKey,
							openaiBaseUrl,
							geminiApiKey,
							geminiBaseUrl,
						} = settings.apiSettings;
						this.apiSettings = {
							openaiApiKey,
							openaiBaseUrl,
							geminiApiKey,
							geminiBaseUrl,
						};
					}
					if (settings.appSettings) {
						this.appSettings = settings.appSettings;
					}
				}
			}

			console.log(
				`[FileStore] Loaded ${this.conversations.size} conversations, ${this.projects.size} projects, ${this.locks.size} locks, and ${this.approvals.size} approvals from ${this.dataDir}`,
			);
			this.scheduleSave();
		} catch (err) {
			console.error("[FileStore] Failed to load data:", err);
		}
	}

	private scheduleSave() {
		if (!this.dataDir) return;

		if (this.saveTimeout) {
			clearTimeout(this.saveTimeout);
		}
		this.saveTimeout = setTimeout(() => {
			this.saveSync();
		}, 500);
	}

	private saveSync() {
		if (!this.dataDir) return;
		const {
			conversationsPath,
			projectsPath,
			locksPath,
			approvalsPath,
			settingsPath,
		} = this;
		if (
			!conversationsPath ||
			!projectsPath ||
			!locksPath ||
			!approvalsPath ||
			!settingsPath
		) {
			return;
		}

		try {
			const dir = path.dirname(conversationsPath);
			if (!fs.existsSync(dir)) {
				fs.mkdirSync(dir, { recursive: true });
			}

			fs.writeFileSync(
				conversationsPath,
				JSON.stringify(Array.from(this.conversations.values()), null, 2),
				"utf-8",
			);
			fs.writeFileSync(
				projectsPath,
				JSON.stringify(Array.from(this.projects.values()), null, 2),
				"utf-8",
			);
			fs.writeFileSync(
				locksPath,
				JSON.stringify(Array.from(this.locks.values()), null, 2),
				"utf-8",
			);
			fs.writeFileSync(
				approvalsPath,
				JSON.stringify(Array.from(this.approvals.values()), null, 2),
				"utf-8",
			);
			fs.writeFileSync(
				settingsPath,
				JSON.stringify(
					{
						apiSettings: this.apiSettings,
						appSettings: this.appSettings,
					},
					null,
					2,
				),
				"utf-8",
			);
			console.log(
				`[FileStore] Saved ${this.conversations.size} conversations, ${this.projects.size} projects, ${this.locks.size} locks, and ${this.approvals.size} approvals to ${this.dataDir}`,
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
