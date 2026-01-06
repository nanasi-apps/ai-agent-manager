import { os } from "@orpc/server";
import { z } from "zod";
import { agentsRouter } from "./agents";
import { apiSettingsRouter } from "./api-settings";
import { appSettingsRouter } from "./app-settings";
import { approvalsRouter } from "./approvals";
import { conversationsRouter } from "./conversations";
import { locksRouter } from "./locks";
import { getSessionMcpServersLogic, listMcpToolsLogic, mcpRouter } from "./mcp";
export { getSessionMcpServersLogic, listMcpToolsLogic, mcpRouter };

import { devServerRouter } from "./dev-server";
import { modelsRouter } from "./models";
import { projectsRouter } from "./projects";
// Import all sub-routers
import { rulesRouter } from "./rules";
import { webServerRouter } from "./web-server";
import { worktreesRouter } from "./worktrees";

// Re-export services for external use
export {
	getAgentManagerOrThrow,
	getGtrConfigServiceOrThrow,
	getHandoverServiceOrThrow,
	getNativeDialog,
	getStoreOrThrow,
	getWebServerServiceOrThrow,
	getWorktreeManagerOrThrow,
	type IAgentManager,
	type IGtrConfigService,
	type INativeDialog,
	type IWebServerService,
	type IWebServerStatus,
	setAgentManager,
	setDevServerService,
	setGtrConfigService,
	setHandoverService,
	setNativeDialog,
	setStore,
	setWebServerService,
	setWorktreeManager,
} from "../services/dependency-container";
// Re-export model utilities
export {
	buildModelId,
	HARDCODED_MODELS,
	parseModelId,
} from "../services/model-fetcher";
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

	// App Settings
	...appSettingsRouter,

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

	// MCP
	...mcpRouter,

	// Approvals
	...approvalsRouter,

	// Dev Server
	...devServerRouter,

	// Web Server
	...webServerRouter,
});

export type AppRouter = typeof appRouter;
