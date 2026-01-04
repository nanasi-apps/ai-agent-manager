export interface Worktree {
	id: string; // usually the directory path
	path: string; // absolute path
	branch: string; // branch name or commit hash
	isMain: boolean; // is this the main worktree?
	isLocked: boolean; // is it currently locked by "git worktree lock"?
	prunable: string | null; // reason if prunable, null otherwise
	conversations?: WorktreeConversation[];
}

export interface WorktreeConversation {
	id: string;
	title: string;
}

export interface WorktreeStatusEntry {
	path: string;
	status: string;
}

export interface WorktreeStatus {
	branch: string;
	upstream?: string;
	ahead: number;
	behind: number;
	entries: WorktreeStatusEntry[];
	raw: string;
}

export interface WorktreeDiff {
	text: string;
	hasChanges: boolean;
	untracked: string[];
}

export interface WorktreeCommit {
	hash: string;
	shortHash: string;
	author: string;
	date: string;
	subject: string;
}

export interface WorktreeCreateOptions {
	projectId: string; // to look up the root path
	branchName: string; // new branch name or existing
	baseBranch?: string; // e.g. 'main'
	directoryName?: string; // folder name for the worktree
}

export interface IWorktreeManager {
	getWorktrees(projectRoot: string): Promise<Worktree[]>;
	createWorktree(
		projectRoot: string,
		branch: string,
		relativePath?: string,
	): Promise<Worktree>;
	removeWorktree(
		projectRoot: string,
		worktreePath: string,
		force?: boolean,
	): Promise<void>;
	pruneWorktrees(projectRoot: string): Promise<void>;
	getWorktreeStatus(worktreePath: string): Promise<WorktreeStatus>;
	getWorktreeDiff(worktreePath: string): Promise<WorktreeDiff>;
	listWorktreeCommits(
		worktreePath: string,
		limit?: number,
	): Promise<WorktreeCommit[]>;
}
