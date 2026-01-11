import { os } from "@orpc/server";
import { z } from "zod";
import type { RouterContext } from "./createRouter";

export function createWebServerRouter(ctx: RouterContext) {
	return {
		webServer: os.router({
			start: os
				.input(
					z.object({
						port: z.number().optional(),
						host: z.string().optional(),
					}),
				)
				.output(
					z.object({
						isRunning: z.boolean(),
						port: z.number().optional(),
						localUrl: z.string().optional(),
						networkUrl: z.string().optional(),
					}),
				)
				.handler(async ({ input }) => {
					return await ctx.webServerService.start(input);
				}),

			stop: os
				.input(z.void())
				.output(z.boolean())
				.handler(async () => {
					return await ctx.webServerService.stop();
				}),

			getStatus: os
				.input(z.void())
				.output(
					z.object({
						isRunning: z.boolean(),
						port: z.number().optional(),
						localUrl: z.string().optional(),
						networkUrl: z.string().optional(),
					}),
				)
				.handler(async () => {
					return await ctx.webServerService.getStatus();
				}),
		}),
	};
}
