/**
 * Main router entry point
 *
 * This file re-exports all router functionality from the modular router/ directory.
 * The router has been split into separate modules for better maintainability:
 *
 * - router/rules.ts        - Global rules CRUD
 * - router/api-settings.ts - API settings management
 * - router/projects.ts     - Project CRUD
 * - router/models.ts       - Agent and model templates
 * - router/conversations.ts - Conversation and message management
 * - router/worktrees.ts    - Git worktree management
 * - router/locks.ts        - Resource lock management
 * - router/agents.ts       - Agent session management
 *
 * Services are located in:
 * - services/dependency-container.ts - Dependency injection container
 * - services/model-fetcher.ts        - OpenAI/Gemini model fetching
 * - services/rules-resolver.ts       - Project rules resolution
 *
 * Utilities are in:
 * - utils/index.ts - Common utilities (generateUUID, withTimeout)
 */

export * from "./router/index";
