import { os } from "@orpc/server";
import { z } from "zod";
import { AgentConfigSchema } from "../types/launch-config";
import type { Project } from "../types/store";
import { generateUUID } from "../utils";
import { getRouterContext } from "./createRouter";

const GtrConfigSchema = z.object({
	copy: z.object({
		include: z.array(z.string()),
		exclude: z.array(z.string()),
		includeDirs: z.array(z.string()),
		excludeDirs: z.array(z.string()),
	}),
	hooks: z.object({
		postCreate: z.array(z.string()),
	}),
});

const AutoConfigSchema = AgentConfigSchema;

export const projectsRouter = {
	getGtrConfig: os
		.input(z.object({ projectId: z.string() }))
		.output(GtrConfigSchema)
		.handler(async ({ input }) => {
			const ctx = getRouterContext();
			const project = ctx.store.getProject(input.projectId);
			if (!project || !project.rootPath) {
				return {
					copy: {
						include: [],
						exclude: [],
						includeDirs: [],
						excludeDirs: [],
					},
					hooks: { postCreate: [] },
				};
			}
			return ctx.gtrConfigService.getGtrConfig(project.rootPath);
		}),

	updateGtrConfig: os
		.input(
			z.object({
				projectId: z.string(),
				config: GtrConfigSchema,
			}),
		)
		.output(z.object({ success: z.boolean() }))
		.handler(async ({ input }) => {
			const ctx = getRouterContext();
			const project = ctx.store.getProject(input.projectId);
			if (!project || !project.rootPath) return { success: false };

			await ctx.gtrConfigService.updateGtrConfig(
				project.rootPath,
				input.config,
			);
			return { success: true };
		}),

	listProjects: os
		.output(
			z.array(
				z.object({
					id: z.string(),
					name: z.string(),
					description: z.string().optional(),
					rootPath: z.string().optional(),
					createdAt: z.number(),
					updatedAt: z.number(),
				}),
			),
		)
		.handler(async () => {
			const ctx = getRouterContext();
			return ctx.store.listProjects();
		}),

	createProject: os
		.input(
			z.object({
				name: z.string(),
				description: z.string().optional(),
				rootPath: z.string().min(1),
			}),
		)
		.output(
			z.object({
				id: z.string(),
			}),
		)
		.handler(async ({ input }) => {
			const ctx = getRouterContext();
			const id = generateUUID();
			const now = Date.now();
			ctx.store.addProject({
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
		.output(
			z
				.object({
					id: z.string(),
					name: z.string(),
					description: z.string().optional(),
					rootPath: z.string().optional(),
					createdAt: z.number(),
					updatedAt: z.number(),
					disabledGlobalRules: z.array(z.string()).optional(),
					projectRules: z
						.array(
							z.object({
								id: z.string(),
								name: z.string(),
								content: z.string(),
							}),
						)
						.optional(),
					autoConfig: AutoConfigSchema.optional(),
				})
				.nullable(),
		)
		.handler(async ({ input }) => {
			const ctx = getRouterContext();
			const project = ctx.store.getProject(input.projectId);
			if (!project) return null;
			return {
				id: project.id,
				name: project.name,
				description: project.description,
				rootPath: project.rootPath,
				createdAt: project.createdAt,
				updatedAt: project.updatedAt,
				disabledGlobalRules: project.disabledGlobalRules,
				projectRules: project.projectRules,
				autoConfig: project.autoConfig,
			};
		}),

	updateProject: os
		.input(
			z.object({
				projectId: z.string(),
				name: z.string().min(1).optional(),
				rootPath: z.string().nullable().optional(),
				disabledGlobalRules: z.array(z.string()).optional(),
				projectRules: z
					.array(
						z.object({
							id: z.string(),
							name: z.string(),
							content: z.string(),
						}),
					)
					.optional(),
				autoConfig: AutoConfigSchema.nullable().optional(),
			}),
		)
		.output(z.object({ success: z.boolean() }))
		.handler(async ({ input }) => {
			const ctx = getRouterContext();
			const project = ctx.store.getProject(input.projectId);
			if (!project) return { success: false };

			const updates: Partial<Project> = {};
			if (input.name !== undefined) {
				updates.name = input.name;
			}
			if ("rootPath" in input) {
				updates.rootPath = input.rootPath ?? undefined;
			}
			if (input.disabledGlobalRules !== undefined) {
				updates.disabledGlobalRules = input.disabledGlobalRules;
			}
			if (input.projectRules !== undefined) {
				updates.projectRules = input.projectRules;
			}
			if (input.autoConfig !== undefined) {
				updates.autoConfig = input.autoConfig ?? undefined;
			}

			ctx.store.updateProject(input.projectId, updates);

			return { success: true };
		}),

	deleteProject: os
		.input(z.object({ projectId: z.string() }))
		.output(z.object({ success: z.boolean() }))
		.handler(async ({ input }) => {
			const ctx = getRouterContext();
			const project = ctx.store.getProject(input.projectId);
			if (!project) return { success: false };

			ctx.store.deleteProject(input.projectId);
			return { success: true };
		}),
};
