/**
 * Ports - Abstract interfaces that define contracts for adapters
 *
 * These interfaces represent the "ports" in hexagonal/ports-and-adapters architecture.
 * They define WHAT capabilities are needed, not HOW they are implemented.
 *
 * The packages/electron module implements these interfaces (adapters).
 * The packages/shared module only defines them (ports).
 *
 * @example
 * // In electron:
 * import type { IAgentManager } from '@agent-manager/shared/ports';
 * class UnifiedAgentManager implements IAgentManager { ... }
 *
 * // In shared router:
 * import type { IAgentManager } from '../ports';
 * function createRouter(ctx: { agentManager: IAgentManager }) { ... }
 */

export * from "./agent-manager";
export * from "./store";
export * from "./worktree-manager";
export * from "./native-dialog";
export * from "./dev-server-service";
export * from "./web-server-service";
export * from "./handover-service";
export * from "./gtr-config-service";
