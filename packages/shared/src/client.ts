/**
 * Client-Side Entry Point
 *
 * This file exports ONLY the artifacts from @agent-manager/shared that are safe
 * to use in a browser/client environment (contracts, types, utils).
 *
 * It explicitly EXCLUDES:
 * - Server-side router logic (createRouter, appRouter)
 * - Node.js specific services
 * - DI containers that pull in server dependencies
 */

// Contracts - data shapes and typed events
export * from "./contracts";
export * from "./ports";
export * from "./types/index";
export * from "./types/launch-config";

// Safe Utils
export { generateUUID, startAgentSession, withTimeout } from "./utils";
export * from "./utils/logger";

// Templates
export * from "./templates/handover-templates";
export * from "./templates/mode-prompts";

// Router Types ONLY
export type { AppRouter, AppRouterFromFactory, RouterContext } from "./router";
export type { McpServerEntry } from "./router/mcp";

// Model Utilities (Pure functions)
export {
    buildModelId,
    MODEL_CACHE_TTL_MS,
    parseModelId,
} from "./services/model-fetcher";
