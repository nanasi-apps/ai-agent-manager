import { os } from "@orpc/server";
import { z } from "zod";
import { agentsRouter } from "./agents";
import { apiSettingsRouter } from "./api-settings";
import { conversationsRouter } from "./conversations";
import { locksRouter } from "./locks";
import { modelsRouter } from "./models";
import { projectsRouter } from "./projects";
// Import all sub-routers
import { rulesRouter } from "./rules";
import { worktreesRouter } from "./worktrees";

// Re-export services for external use
export {
	getAgentManagerOrThrow,
	getNativeDialog,
	getStoreOrThrow,
	getWorktreeManagerOrThrow,
	type IAgentManager,
	type INativeDialog,
	setAgentManager,
	setNativeDialog,
	setStore,
	setWorktreeManager,
} from "../services/dependency-container";
// Re-export model utilities
export { buildModelId, parseModelId } from "../services/model-fetcher";
// Re-export utilities
export { generateUUID } from "../utils";

// Combined app router
export const appRouter = os.router({
	// Ping endpoint
	ping: os
		.input(z.void())
		.output(z.string())
		.handler(async () => {
			console.log("Ping received on server");
			return "pong from electron (ORPC)";
		}),

	// Platform endpoint
	getPlatform: os
		.output(z.enum(["electron", "web"]))
		.handler(async () => "electron" as const),

	// Rules
	...rulesRouter,

	// API Settings
	...apiSettingsRouter,

	// Projects
	...projectsRouter,

	// Models
	...modelsRouter,

	// Conversations
	...conversationsRouter,

	// Worktrees
	...worktreesRouter,

	// Locks
	...locksRouter,

	// Agents
	...agentsRouter,
});

export type AppRouter = typeof appRouter;
