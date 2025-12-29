import { os } from "@orpc/server";
import { z } from "zod";
import { getStoreOrThrow } from "../services/dependency-container";

export const locksRouter = {
	acquireLock: os
		.input(
			z.object({
				resourceId: z.string(),
				agentId: z.string(),
				intent: z.string(),
				ttlMs: z.number().optional(),
			}),
		)
		.output(z.boolean())
		.handler(async ({ input }) => {
			const expiresAt = input.ttlMs ? Date.now() + input.ttlMs : undefined;
			return getStoreOrThrow().acquireLock({
				resourceId: input.resourceId,
				agentId: input.agentId,
				intent: input.intent,
				timestamp: Date.now(),
				expiresAt,
			});
		}),

	releaseLock: os
		.input(
			z.object({
				resourceId: z.string(),
				agentId: z.string(),
			}),
		)
		.output(z.boolean())
		.handler(async ({ input }) => {
			return getStoreOrThrow().releaseLock(input.resourceId, input.agentId);
		}),

	getLock: os
		.input(z.object({ resourceId: z.string() }))
		.output(
			z
				.object({
					resourceId: z.string(),
					agentId: z.string(),
					intent: z.string(),
					timestamp: z.number(),
					expiresAt: z.number().optional(),
				})
				.optional(),
		)
		.handler(async ({ input }) => {
			return getStoreOrThrow().getLock(input.resourceId);
		}),

	listLocks: os
		.output(
			z.array(
				z.object({
					resourceId: z.string(),
					agentId: z.string(),
					intent: z.string(),
					timestamp: z.number(),
					expiresAt: z.number().optional(),
				}),
			),
		)
		.handler(async () => {
			return getStoreOrThrow().listLocks();
		}),

	forceReleaseLock: os
		.input(z.object({ resourceId: z.string() }))
		.output(z.void())
		.handler(async ({ input }) => {
			getStoreOrThrow().forceReleaseLock(input.resourceId);
		}),
};
