/**
 * Contracts - Data shapes and schemas for the agent-manager API
 *
 * This directory contains:
 * - Zod schemas for input/output validation
 * - TypeScript types derived from schemas
 * - DTOs (Data Transfer Objects)
 *
 * Unlike "ports" which define interface contracts for DI,
 * "contracts" define the shape of data flowing through the system.
 *
 * @example
 * import { AgentConfigSchema, type AgentConfig } from '@agent-manager/shared/contracts';
 */

// Re-export existing types that are already "contracts"
// These will gradually migrate into this directory

export * from "./events";

// Future: Move schemas here
// export * from './schemas/agent';
// export * from './schemas/project';
// export * from './schemas/conversation';
