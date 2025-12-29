import { os } from "@orpc/server";
import { z } from "zod";
import { getStoreOrThrow, getWorktreeManagerOrThrow } from "../services/dependency-container";

export const worktreesRouter = {
    listWorktrees: os
        .input(z.object({ projectId: z.string() }))
        .output(z.array(z.object({
            id: z.string(),
            path: z.string(),
            branch: z.string(),
            isMain: z.boolean(),
            isLocked: z.boolean(),
            prunable: z.string().nullable()
        })))
        .handler(async ({ input }) => {
            const project = getStoreOrThrow().getProject(input.projectId);
            if (!project || !project.rootPath) throw new Error('Project has no root path');
            return getWorktreeManagerOrThrow().getWorktrees(project.rootPath);
        }),

    createWorktree: os
        .input(z.object({
            projectId: z.string(),
            branch: z.string(),
            relativePath: z.string().optional()
        }))
        .output(z.object({
            success: z.boolean(),
            worktree: z.object({
                id: z.string(),
                path: z.string(),
                branch: z.string(),
                isMain: z.boolean(),
                isLocked: z.boolean(),
                prunable: z.string().nullable()
            }).optional()
        }))
        .handler(async ({ input }) => {
            const project = getStoreOrThrow().getProject(input.projectId);
            if (!project || !project.rootPath) throw new Error('Project has no root path');
            const wt = await getWorktreeManagerOrThrow().createWorktree(project.rootPath, input.branch, input.relativePath);
            return { success: true, worktree: wt };
        }),

    removeWorktree: os
        .input(z.object({
            projectId: z.string(),
            path: z.string(),
            force: z.boolean().optional()
        }))
        .output(z.object({ success: z.boolean() }))
        .handler(async ({ input }) => {
            const project = getStoreOrThrow().getProject(input.projectId);
            if (!project || !project.rootPath) throw new Error('Project has no root path');
            await getWorktreeManagerOrThrow().removeWorktree(project.rootPath, input.path, input.force);
            return { success: true };
        }),

    getWorktreeStatus: os
        .input(z.object({
            projectId: z.string(),
            path: z.string()
        }))
        .output(z.object({
            branch: z.string(),
            upstream: z.string().optional(),
            ahead: z.number(),
            behind: z.number(),
            entries: z.array(z.object({
                path: z.string(),
                status: z.string()
            })),
            raw: z.string()
        }))
        .handler(async ({ input }) => {
            const project = getStoreOrThrow().getProject(input.projectId);
            if (!project || !project.rootPath) throw new Error('Project has no root path');
            return getWorktreeManagerOrThrow().getWorktreeStatus(input.path);
        }),

    getWorktreeDiff: os
        .input(z.object({
            projectId: z.string(),
            path: z.string()
        }))
        .output(z.object({
            text: z.string(),
            hasChanges: z.boolean(),
            untracked: z.array(z.string())
        }))
        .handler(async ({ input }) => {
            const project = getStoreOrThrow().getProject(input.projectId);
            if (!project || !project.rootPath) throw new Error('Project has no root path');
            return getWorktreeManagerOrThrow().getWorktreeDiff(input.path);
        }),

    listWorktreeCommits: os
        .input(z.object({
            projectId: z.string(),
            path: z.string(),
            limit: z.number().optional()
        }))
        .output(z.array(z.object({
            hash: z.string(),
            shortHash: z.string(),
            author: z.string(),
            date: z.string(),
            subject: z.string()
        })))
        .handler(async ({ input }) => {
            const project = getStoreOrThrow().getProject(input.projectId);
            if (!project || !project.rootPath) throw new Error('Project has no root path');
            return getWorktreeManagerOrThrow().listWorktreeCommits(input.path, input.limit);
        }),
};
