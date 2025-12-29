import { os } from "@orpc/server";
import { z } from "zod";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { getStoreOrThrow } from "../services/dependency-container";
import { RULES_DIR } from "../services/rules-resolver";
import { generateUUID } from "../utils";
import type { Project } from "../types/store";

export const projectsRouter = {
    listProjects: os
        .output(z.array(z.object({
            id: z.string(),
            name: z.string(),
            description: z.string().optional(),
            rootPath: z.string().optional(),
            createdAt: z.number(),
            updatedAt: z.number(),
        })))
        .handler(async () => {
            return getStoreOrThrow().listProjects();
        }),

    createProject: os
        .input(z.object({
            name: z.string(),
            description: z.string().optional(),
            rootPath: z.string().min(1),
        }))
        .output(z.object({
            id: z.string(),
        }))
        .handler(async ({ input }) => {
            const id = generateUUID();
            const now = Date.now();
            getStoreOrThrow().addProject({
                id,
                name: input.name,
                description: input.description,
                rootPath: input.rootPath,
                createdAt: now,
                updatedAt: now,
            });
            return { id };
        }),

    getProject: os
        .input(z.object({ projectId: z.string() }))
        .output(z.object({
            id: z.string(),
            name: z.string(),
            description: z.string().optional(),
            rootPath: z.string().optional(),
            createdAt: z.number(),
            updatedAt: z.number(),
            activeGlobalRules: z.array(z.string()).optional(),
            projectRules: z.array(z.object({
                id: z.string(),
                name: z.string(),
                content: z.string()
            })).optional(),
        }).nullable())
        .handler(async ({ input }) => {
            const project = getStoreOrThrow().getProject(input.projectId);
            if (!project) return null;
            return {
                id: project.id,
                name: project.name,
                description: project.description,
                rootPath: project.rootPath,
                createdAt: project.createdAt,
                updatedAt: project.updatedAt,
                activeGlobalRules: project.activeGlobalRules,
                projectRules: project.projectRules,
            };
        }),

    updateProject: os
        .input(z.object({
            projectId: z.string(),
            name: z.string().min(1).optional(),
            rootPath: z.string().nullable().optional(),
            activeGlobalRules: z.array(z.string()).optional(),
            projectRules: z.array(z.object({
                id: z.string(),
                name: z.string(),
                content: z.string()
            })).optional(),
        }))
        .output(z.object({ success: z.boolean() }))
        .handler(async ({ input }) => {
            const storeInstance = getStoreOrThrow();
            const project = storeInstance.getProject(input.projectId);
            if (!project) return { success: false };

            const updates: Partial<Project> = {};
            if (input.name !== undefined) {
                updates.name = input.name;
            }
            if (Object.prototype.hasOwnProperty.call(input, 'rootPath')) {
                updates.rootPath = input.rootPath ?? undefined;
            }
            if (input.activeGlobalRules !== undefined) {
                updates.activeGlobalRules = input.activeGlobalRules;
            }
            if (input.projectRules !== undefined) {
                updates.projectRules = input.projectRules;
            }

            storeInstance.updateProject(input.projectId, updates);

            // Generate rule files in project root (commented out - preserved for future use)
            const updatedProject = storeInstance.getProject(input.projectId);
            if (updatedProject && updatedProject.rootPath) {
                try {
                    let globalRulesContent = '';
                    if (updatedProject.activeGlobalRules && updatedProject.activeGlobalRules.length > 0) {
                        for (const ruleId of updatedProject.activeGlobalRules) {
                            try {
                                const ruleContent = await readFile(join(RULES_DIR, ruleId), 'utf-8');
                                globalRulesContent += `\n\n<!-- Rule: ${ruleId} -->\n${ruleContent}`;
                            } catch (e) {
                                console.warn(`Failed to read rule ${ruleId}`, e);
                            }
                        }
                    }

                    let projectRulesContent = '';
                    if (updatedProject.projectRules && updatedProject.projectRules.length > 0) {
                        for (const rule of updatedProject.projectRules) {
                            projectRulesContent += `\n\n<!-- Project Rule: ${rule.name} -->\n${rule.content}`;
                        }
                    }

                    /*
                    const finalContent = `${globalRulesContent}\n\n<!-- Project Specific Rules -->\n${projectRulesContent}`.trim();

                    await writeFile(join(updatedProject.rootPath, 'Agents.md'), finalContent, 'utf-8');
                    await writeFile(join(updatedProject.rootPath, 'Claude.md'), finalContent, 'utf-8');
                    */
                } catch (e) {
                    console.error("Failed to generate rule files", e);
                }
            }

            return { success: true };
        }),
};
