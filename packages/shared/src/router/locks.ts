import { os } from "@orpc/server";
import { z } from "zod";
import type { RouterContext } from "./createRouter";

export function createLocksRouter(ctx: RouterContext) {
	return {
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
				return ctx.store.acquireLock({
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
				return ctx.store.releaseLock(input.resourceId, input.agentId);
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
				return ctx.store.getLock(input.resourceId);
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
				return ctx.store.listLocks();
			}),

		forceReleaseLock: os
			.input(z.object({ resourceId: z.string() }))
			.output(z.void())
			.handler(async ({ input }) => {
				ctx.store.forceReleaseLock(input.resourceId);
			}),
	};
}
