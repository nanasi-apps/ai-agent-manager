import { os } from "@orpc/server";
import { z } from "zod";
import { getWebServerServiceOrThrow } from "../services/dependency-container";

export const webServerRouter = {
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
				return await getWebServerServiceOrThrow().start(input);
			}),

		stop: os
			.input(z.void())
			.output(z.boolean())
			.handler(async () => {
				return await getWebServerServiceOrThrow().stop();
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
				return await getWebServerServiceOrThrow().getStatus();
			}),
	}),
};
