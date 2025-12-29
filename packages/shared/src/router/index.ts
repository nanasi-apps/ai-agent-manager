import { os } from "@orpc/server";
import { z } from "zod";

// Import all sub-routers
import { rulesRouter } from "./rules";
import { apiSettingsRouter } from "./api-settings";
import { projectsRouter } from "./projects";
import { modelsRouter } from "./models";
import { conversationsRouter } from "./conversations";
import { worktreesRouter } from "./worktrees";
import { locksRouter } from "./locks";
import { agentsRouter } from "./agents";

// Re-export services for external use
export {
    setAgentManager,
    setStore,
    setNativeDialog,
    setWorktreeManager,
    getStoreOrThrow,
    getAgentManagerOrThrow,
    getNativeDialog,
    getWorktreeManagerOrThrow,
    type IAgentManager,
    type INativeDialog,
} from "../services/dependency-container";

// Re-export utilities
export { generateUUID } from "../utils";

// Re-export model utilities
export { parseModelId, buildModelId } from "../services/model-fetcher";

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
