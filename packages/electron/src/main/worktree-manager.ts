import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import * as path from 'node:path';
import type { Worktree } from '@agent-manager/shared';
import * as fs from 'node:fs/promises';

const execAsync = promisify(exec);

export class WorktreeManager {
    
    async getWorktrees(projectRoot: string): Promise<Worktree[]> {
        try {
            const { stdout } = await execAsync('git worktree list --porcelain', { cwd: projectRoot });
            return this.parseWorktreeList(stdout);
        } catch (error) {
            console.error('[WorktreeManager] Failed to list worktrees:', error);
            throw error;
        }
    }

    private parseWorktreeList(output: string): Worktree[] {
        const worktrees: Worktree[] = [];
        const blocks = output.trim().split('\n\n');

        for (const block of blocks) {
            const lines = block.split('\n');
            const data: any = {};
            
            for (const line of lines) {
                const [key, ...values] = line.split(' ');
                const value = values.join(' ');
                data[key] = value;
            }

            if (data.worktree) {
                worktrees.push({
                    id: data.worktree,
                    path: data.worktree,
                    branch: data.branch ? data.branch.replace('refs/heads/', '') : (data.HEAD || 'detached'),
                    isMain: false, // logic to determine main? usually the first one but not guaranteed by porcelain? 
                    // usually the one matching the repo root is main
                    // We'll update isMain logic later if needed
                    isLocked: !!data.locked,
                    prunable: data.prunable || null
                });
            }
        }
        
        // Basic heuristic: Shortest path is usually main? Or check .git folder vs file? 
        // For now, let's assume the first one listed is main (git behavior)
        if (worktrees.length > 0) {
            worktrees[0].isMain = true;
        }

        return worktrees;
    }

    async createWorktree(projectRoot: string, branch: string, relativePath?: string): Promise<Worktree> {
        // default path: .worktrees/<branch>
        const targetPath = relativePath || `.worktrees/${branch}`;
        const absolutePath = path.resolve(projectRoot, targetPath);

        // Check if branch exists
        let createBranchFlag = '';
        try {
            await execAsync(`git rev-parse --verify ${branch}`, { cwd: projectRoot });
            // Branch exists, checkout it
            createBranchFlag = ''; 
        } catch (e) {
            // Branch does not exist, create it (-b)
            createBranchFlag = `-b ${branch}`;
        }

        try {
            const cmd = `git worktree add ${createBranchFlag} "${targetPath}" ${branch}`;
            console.log(`[WorktreeManager] Executing: ${cmd}`);
            await execAsync(cmd, { cwd: projectRoot });
            
            // Return the new worktree object
            // We can fetch list again or construct it manually
            return {
                id: absolutePath,
                path: absolutePath,
                branch: branch,
                isMain: false,
                isLocked: false,
                prunable: null
            };
        } catch (error) {
            console.error('[WorktreeManager] Failed to create worktree:', error);
            throw error;
        }
    }

    async removeWorktree(projectRoot: string, worktreePath: string, force: boolean = false): Promise<void> {
        try {
            const cmd = `git worktree remove ${force ? '--force' : ''} "${worktreePath}"`;
            console.log(`[WorktreeManager] Executing: ${cmd}`);
            await execAsync(cmd, { cwd: projectRoot });
        } catch (error) {
            console.error('[WorktreeManager] Failed to remove worktree:', error);
            throw error;
        }
    }

    async pruneWorktrees(projectRoot: string): Promise<void> {
         try {
            await execAsync('git worktree prune', { cwd: projectRoot });
        } catch (error) {
            console.error('[WorktreeManager] Failed to prune worktrees:', error);
            throw error;
        }
    }
}

export const worktreeManager = new WorktreeManager();
