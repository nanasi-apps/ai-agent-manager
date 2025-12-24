import { os } from "@orpc/server";
import { z } from "zod";

export const appRouter = os.router({
	ping: os
		.input(z.void())
		.output(z.string())
		.handler(async () => {
			console.log("Ping received on server");
			return "pong from electron (ORPC)";
		}),

	getPlatform: os
		.output(z.enum(["electron", "web"]))
		.handler(async () => "electron" as const),
});

export type AppRouter = typeof appRouter;
