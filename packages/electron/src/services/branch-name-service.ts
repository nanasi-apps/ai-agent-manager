import { randomUUID } from "node:crypto";
import { BrowserWindow, Notification } from "electron";
import { getLogger, type BranchNameRequest } from "@agent-manager/shared";
import { store } from "../store/file-store";

type PendingEntry = {
	request: BranchNameRequest;
	resolve: (branchName: string) => void;
	reject: (error: Error) => void;
};

const logger = getLogger(["electron", "branch-name"]);

function generateId(): string {
	try {
		return randomUUID();
	} catch {
		// Fallback for environments without crypto support
		return `branch-${Date.now().toString(36)}`;
	}
}

function slugify(text: string, fallback: string): string {
	const cleaned = text
		.toLowerCase()
		.replace(/[^a-z0-9\s-]/g, " ")
		.replace(/\s+/g, " ")
		.trim();
	if (!cleaned) return fallback;

	const stopwords = new Set([
		"a",
		"an",
		"the",
		"to",
		"for",
		"and",
		"or",
		"of",
		"in",
		"on",
		"with",
		"fix",
	]);

	const words = cleaned
		.split(" ")
		.filter((word) => word && !stopwords.has(word))
		.slice(0, 8);

	if (words.length === 0) return fallback;

	return words.join("-").replace(/-+/g, "-");
}

function choosePrefix(summary?: string): string {
	if (!summary) return "feature";
	const lower = summary.toLowerCase();
	if (lower.includes("bug") || lower.includes("fix") || lower.includes("hotfix")) {
		return "fix";
	}
	if (lower.includes("refactor") || lower.includes("cleanup")) {
		return "refactor";
	}
	return "feature";
}

function bringWindowToFront() {
	const win = BrowserWindow.getAllWindows()[0];
	if (win) {
		if (win.isMinimized()) win.restore();
		win.show();
		win.focus();
	}
}

export class BranchNamePromptService {
	private pending = new Map<string, PendingEntry>();

	async promptForBranchName(options: {
		repoPath: string;
		projectId?: string;
		sessionId?: string;
		suggestedBranch?: string;
		summary?: string;
	}): Promise<string> {
		const summary = this.buildSummary(options);
		const request: BranchNameRequest = {
			id: generateId(),
			repoPath: options.repoPath,
			projectId: options.projectId,
			sessionId: options.sessionId,
			suggestedBranch: options.suggestedBranch,
			summary,
			createdAt: Date.now(),
			status: "pending",
		};

		const promise = new Promise<string>((resolve, reject) => {
			this.pending.set(request.id, { request, resolve, reject });
		});

		this.broadcast("branch-name:request", request);
		this.notify(request);

		return promise;
	}

	submitBranchName(requestId: string, branchName: string): BranchNameRequest {
		const entry = this.pending.get(requestId);
		if (!entry) {
			throw new Error("Branch name request not found");
		}

		const trimmed = branchName.trim();
		if (!trimmed) {
			throw new Error("Branch name cannot be empty");
		}

		this.pending.delete(requestId);
		entry.resolve(trimmed);

		const resolved: BranchNameRequest = {
			...entry.request,
			status: "resolved",
		};
		this.broadcast("branch-name:resolved", {
			requestId,
			branchName: trimmed,
		});
		return resolved;
	}

	cancel(requestId: string, reason?: string) {
		const entry = this.pending.get(requestId);
		if (!entry) return;
		this.pending.delete(requestId);
		entry.reject(new Error(reason || "Branch name request cancelled"));
		this.broadcast("branch-name:resolved", { requestId, cancelled: true });
	}

	listPending(): BranchNameRequest[] {
		return Array.from(this.pending.values()).map((entry) => entry.request);
	}

	async generateSuggestion(requestId: string): Promise<string> {
		const entry = this.pending.get(requestId);
		if (!entry) {
			throw new Error("Branch name request not found");
		}

		const context =
			entry.request.summary ||
			entry.request.suggestedBranch ||
			entry.request.repoPath;

		const prefix = choosePrefix(entry.request.summary);
		const slug = slugify(
			context ?? "branch",
			entry.request.suggestedBranch || "branch",
		);
		const suggestion = `${prefix}/${slug}`;
		logger.info("Generated branch suggestion for {requestId}: {suggestion}", {
			requestId,
			suggestion,
		});
		return suggestion;
	}

	private buildSummary(options: {
		projectId?: string;
		sessionId?: string;
		summary?: string;
	}): string | undefined {
		if (options.summary) return options.summary;

		if (options.sessionId) {
			const conversation = store.getConversation(options.sessionId);
			if (conversation) {
				const lastUser = [...(conversation.messages || [])]
					.reverse()
					.find((msg) => msg.role === "user");
				if (lastUser?.content) return lastUser.content;
				if (conversation.title) return conversation.title;
				if (conversation.initialMessage) return conversation.initialMessage;
			}
		}

		if (options.projectId) {
			const project = store.getProject(options.projectId);
			if (project?.description) return project.description;
			if (project?.name) return project.name;
		}

		return undefined;
	}

	private notify(request: BranchNameRequest) {
		if (!Notification.isSupported()) return;
		const project =
			request.projectId && store.getProject(request.projectId)?.name;
		const title = "Choose a branch name for the new worktree";
		const bodyParts = [
			project ? `Project: ${project}` : null,
			request.summary ? `Hint: ${request.summary}` : null,
		].filter(Boolean) as string[];
		const notification = new Notification({
			title,
			body: bodyParts.join("\n") || "Click to enter a branch name.",
			silent: false,
		});

		notification.on("click", () => {
			bringWindowToFront();
			this.broadcast("branch-name:open", {
				requestId: request.id,
			});
		});

		notification.show();
	}

	private broadcast(channel: string, payload: unknown) {
		BrowserWindow.getAllWindows().forEach((win) => {
			try {
				win.webContents.send(channel, payload);
			} catch (err) {
				logger.warn(
					"Failed to send branch name event {channel}: {error}",
					{ channel, error: err },
				);
			}
		});
	}
}

export const branchNamePromptService = new BranchNamePromptService();
