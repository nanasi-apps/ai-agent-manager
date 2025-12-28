export interface Worktree {
    id: string; // usually the directory path
    path: string; // absolute path
    branch: string; // branch name or commit hash
    isMain: boolean; // is this the main worktree?
    isLocked: boolean; // is it currently locked by "git worktree lock"?
    prunable: string | null; // reason if prunable, null otherwise
}

export interface WorktreeCreateOptions {
    projectId: string; // to look up the root path
    branchName: string; // new branch name or existing
    baseBranch?: string; // e.g. 'main'
    directoryName?: string; // folder name for the worktree
}

export interface IWorktreeManager {
    getWorktrees(projectRoot: string): Promise<Worktree[]>;
    createWorktree(projectRoot: string, branch: string, relativePath?: string): Promise<Worktree>;
    removeWorktree(projectRoot: string, worktreePath: string, force?: boolean): Promise<void>;
    pruneWorktrees(projectRoot: string): Promise<void>;
}
