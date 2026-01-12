# Refactor.md - Agent Manager Massive Refactor

## Purpose

Transform the `agent-manager` repository to achieve proper separation of concerns:
- **shared**: Pure contracts package (schemas, types, interfaces, router definitions)
- **electron**: Execution kingdom with proper layering (domain/application/infrastructure/adapters)

This refactor will eliminate global DI from shared, remove runtime state/implementations from shared, and create a clean layered architecture in electron that prevents change ripple effects.

## North Star (Definition of Final Form)

### packages/shared (Contracts Package) - ALLOWED:
- ✅ Zod schemas (input/output/DTO)
- ✅ Types (prefer schema-derived types)
- ✅ Event types (streams)
- ✅ oRPC router definitions (factory-based: `createRouter(ctx)`)
- ✅ Abstract interfaces (ports)

### packages/shared - NOT ALLOWED:
- ❌ Implementations (git/pty/fs/http/electron, etc.)
- ❌ Runtime state (singletons, global DI, caches)
- ❌ Electron dependencies
- ❌ `dependency-container.ts` with global setters/getters

### packages/electron (Execution Kingdom) Structure:
```
src/
├── domain/           # Rules, invariants, policies (pure TS)
├── application/      # Use cases and Session Runtime (the core)
│   ├── sessions/     # Session management
│   └── services/     # Application services
├── infrastructure/   # External concerns
│   ├── agent-drivers/  # node-pty, CLI execution
│   ├── git/           # Git operations
│   ├── store/         # Persistence
│   ├── mcp/           # Hono MCP server
│   └── electron/      # Electron-specific (ipc, theme, etc.)
└── adapters/         # Protocol adapters
    ├── orpc/          # oRPC server setup
    └── ipc/           # IPC/MessagePort handlers
```

---

## Milestones

### Milestone 0: Build the Scaffolding ✅ COMPLETE
- [x] Create `Refactor.md` with update rules
- [x] Document milestone list and next actions
- [x] Establish commit discipline: "move-only" vs "implementation-change"

### Milestone 1: Add "contracts layer" to shared ✅ COMPLETE
- [x] Create `packages/shared/src/contracts/`
- [x] Create `packages/shared/src/ports/` (abstract interfaces for electron to implement)
- [x] Create `packages/shared/src/contracts/events/` (typed events)
- [x] Document policy: future work moves toward `contracts`

### Milestone 2: Convert shared router into factory ✅ COMPLETE
- [x] Create `packages/shared/src/router/createRouter.ts`
- [x] Implement `ctx` interface definition (RouterContext)
- [x] Keep compatibility wrappers (existing imports still work)
- [x] electron can call `createRouter(ctx)` directly (ready, wiring in M3)

### Milestone 3: Build `ctx` in electron and move oRPC into adapters ✅ COMPLETE
- [x] Create `packages/electron/src/adapters/orpc/`
- [x] Move `orpc-server.ts` into adapters (new `orpc-adapter.ts`)
- [x] Create bootstrap mechanism (`electron/src/app/bootstrap`)
- [x] Wire Router to Electron IPC via `setupElectronOrpc(router)`
- [x] Wire Router to Web Server via `webServerManager.setRouter(router)`
- [x] Delete old `server/orpc-server.ts` (no longer needed)

### Milestone 4: Move shared/services into electron (IN PROGRESS)
- [x] Create destination: `electron/src/application/services/`
- [x] Create IRulesResolver port interface
- [x] Move `rules-resolver.ts` implementation to electron
- [x] Add rulesResolver to RouterContext and bootstrap
- [x] Fix bootstrap to use createRouter(ctx) enabling getRouterContext()
- [~] Migrate router handlers to use ctx.rulesResolver (1/14 - conversations.ts done)
- [x] Move `model-fetcher.ts` implementation (shared file cleaned)
- [x] Move `session-builder.ts` implementation (shared file deleted)
- [x] Delete/thin `dependency-container.ts` (thinned & deprecated)

### Milestone 5: Layer separation in electron ✅ COMPLETE
- [x] Split `agents/` → `application/sessions/` + `infrastructure/agent-drivers/`
- [x] Move `server/mcp-*` → `infrastructure/mcp/`
- [x] Move `server/orpc-*` → `adapters/orpc/` (Done in M3)
- [x] Move `store/` → `infrastructure/store/`
- [x] Split `main/*` → `infrastructure/electron/` + `application/services/` + `infrastructure/ipc`

### Milestone 6: Unify Session Runtime with typed events (IN PROGRESS)
- [x] Convert output-parser to emit typed events (`SessionEvent` union type)
- [x] One-shot session emits typed events via `emit("session-event", event)`
- [x] Emit `StateChangeEvent` from xstate state subscription
- [x] Emit `SessionLifecycleEvent` at key points (started/stopped/reset)
- [x] Update UI to properly consume all typed event types (currently only LogEvent)
- [x] Add typed event handling for ToolCallEvent, ToolResultEvent, ThinkingEvent in UI

---

## Current Status

**Date**: 2026-01-11 21:30
**Phase**: Milestone 6 - Unify Session Runtime with typed events (COMPLETE)

### Milestone 5 Complete ✅

Layer separation in electron is complete:
- `application/sessions/` - Session managers, state machines, context builders
- `infrastructure/agent-drivers/` - Execution drivers, process utilities
- `infrastructure/store/` - Persistence layer
- `infrastructure/mcp/` - MCP server and tools
- `infrastructure/worktree/` - Git worktree management
- `infrastructure/ipc/` - Electron IPC handling
- `infrastructure/desktop/` - Theme, native dialogs
- `adapters/orpc/` - oRPC protocol adapter

### Milestone 6 Progress (Current Session)

**Typed Events Architecture Status:**

1. ✅ **Typed Events Defined** - `packages/shared/src/contracts/events/index.ts`
   - `LogEvent`, `StateChangeEvent`, `ToolCallEvent`, `ToolResultEvent`
   - `ThinkingEvent`, `ErrorEvent`, `SessionLifecycleEvent`
   - `SessionEvent` union type covers all event types
   - `ISessionEventEmitter` interface for typed event handling

2. ✅ **Output Parser Emits Typed Events** - `output-parser.ts`
   - `AgentOutputParser.processJsonEvent()` returns `ParseResult` with `SessionEvent[]`
   - Creates typed events: LogEvent, ToolCallEvent, ToolResultEvent, ThinkingEvent, ErrorEvent
   - No longer returns string-formatted `ParsedLog` (removed)

3. ✅ **OneShotSession Emits Typed Events**
   - Uses `emit("session-event", event)` for all session events
   - `emitLog()` creates `LogEvent` objects
   - `emitEvent()` emits any `SessionEvent`
   - Managers and logging subscribe to typed events

3. ✅ **OneShotSession Emits Typed Events**
   - Uses `emit("session-event", event)` for all session events
   - `emitLog()` creates `LogEvent` objects
   - `emitEvent()` emits any `SessionEvent`
   - Managers and logging subscribe to typed events

4. ✅ **UI Event Handling (Complete)**
   - `ConversationView.vue` subscribes to `orpc.electron.agent.subscribeEvents`
   - `conversation.ts` store handles specific event types (`addToolCall`, `addThinking`, etc.)
   - `ChatMessageList.vue` renders structured data from `toolCall`/`toolResult` properties
   - Regex parsing removed from store, kept in UI only as fallback for legacy logs

### Handler Migration Progress (Milestone 4) ✅ COMPLETE

All 14 router handler files now use `ctx` from `getRouterContext()`:
- ✅ agents.ts, api-settings.ts, app-settings.ts, approvals.ts
- ✅ conversations.ts, dev-server.ts, locks.ts, mcp.ts
- ✅ models.ts, projects.ts, rules.ts, web-server.ts, worktrees.ts
- ✅ (createRouter.ts orchestrates via factory)

### Milestone 3 Complete! ✅

All oRPC adapters are now properly wired:
- Electron IPC: `main.ts` → `bootstrap()` → `setupElectronOrpc(router)`
- Web Server: `main.ts` → `webServerManager.setRouter(router)` → `startWebServer(port, host, router)`
- Old `server/orpc-server.ts` deleted - no longer needed


### Milestone 5 Strategy

The goal is to split `packages/electron/src/agents/` into two distinct layers:
1. **Application Layer (`application/sessions/`)**: Core session runtime, state machines, context building.
2. **Infrastructure Layer (`infrastructure/agent-drivers/`)**: Execution drivers (local, docker, etc.), PTY management.

**Plan:**
1. Create target directories.
2. Move `drivers/` and execution-related utils to `infrastructure/agent-drivers/`.
3. Move session managers, machines, and builders to `application/sessions/`.
4. Update imports.


**Analysis of shared/services:**
1. `dependency-container.ts` - Global DI with setters/getters → **DELETE** (replace with RouterContext)
2. `model-fetcher.ts`:
   - Pure utilities (`buildModelId`, `parseModelId`) → Keep in shared or move to contracts
   - Implementation (`fetchOpenAIModels`, `fetchGeminiModels`) → Move to electron
   - State (`modelListCache`) → Move to electron
3. `rules-resolver.ts` - Uses `getStoreOrThrow()` + node:fs → Move to electron
4. `session-builder.ts` - Uses `getStoreOrThrow()` + `resolveProjectRules` → Move to electron

**Approach for M4:**
1. Add new service interfaces to `ports/` (e.g., `IModelFetcher`, `IRulesResolver`)
2. Create implementations in `electron/src/application/services/`
3. Add these services to RouterContext
4. Migrate router handlers one by one to use ctx instead of global DI
5. Eventually delete dependency-container.ts when all handlers are migrated

**Created:** `packages/electron/src/application/services/` directory ✅

### Current Architecture Analysis:

**packages/shared/src/services/** (PROBLEM: Milestone 4 target):
- `dependency-container.ts` - Global DI with setters/getters (255 lines)
- `model-fetcher.ts` - Model fetching logic
- `rules-resolver.ts` - Rules resolution logic  
- `session-builder.ts` - Session building logic

**packages/shared/src/router/** (COMPLETE: all handlers migrated to ctx):
- `createRouter.ts` - Factory function accepting RouterContext ✅
- All 14 sub-router files now use `getRouterContext()` instead of global DI ✅
- `_setRouterContext()` bridges handlers during transition

**packages/electron/src/** (M3 Complete, M4/M5 remaining):
- `adapters/orpc/` - oRPC adapter layer ✅
- `app/bootstrap.ts` - Bootstrap module with RouterContext ✅
- `server/web-server.ts` - Updated to use new adapter ✅
- `agents/` - Mixed session runtime + drivers (Milestone 5)
- `main/` - Mixed concerns (Milestone 5)
- `store/` - Should be infrastructure (Milestone 5)

**Dependency Flow (CURRENT - M3 Complete)**:
```
main.ts
  └─→ bootstrap() → builds ctx, sets legacy global DI, returns router
       └─→ passes to setupElectronOrpc(router) ✅
  └─→ webServerManager.setRouter(router) ✅
  └─→ webServerManager.start()
       └─→ startWebServer(port, host, router)
            └─→ attachOrpcToServer(server, router) ✅
```

---

## Next Actions

### Milestone 6 Completion Tasks

1. **Emit SessionLifecycleEvent from xstate transitions**
   - When `agentMachine` transitions (idle→processing, processing→idle, etc.)
   - Emit `SessionLifecycleEvent` with action: started/stopped/paused/resumed
   - Wire `actor.subscribe()` to emit lifecycle events

2. **Add `onSessionEvent` to preload API**
   - Replace/supplement `onAgentLog` + `onAgentStateChanged` with unified `onSessionEvent`
   - UI subscribes to single typed event stream

3. **Update UI to handle all SessionEvent types**
   - Create event handler functions for each event type
   - `LogEvent` → append to messages (current behavior)
   - `ToolCallEvent` → show tool indicator/collapsible
   - `ToolResultEvent` → show result in collapsible
   - `ThinkingEvent` → show thinking indicator
   - `ErrorEvent` → show error message with styling
   - `SessionLifecycleEvent` → update isGenerating/isLoading

4. **Remove legacy `onAgentLog` pattern (optional cleanup)**
   - Once `onSessionEvent` is working, deprecate old listeners
   - Simplify preload.ts exports

---

## Risks / Blockers

| Risk | Impact | Mitigation |
|------|--------|------------|
| Router spread pattern (`...rulesRouter`) may complicate factory conversion | Medium | May need router composition changes |
| Many files import from shared index (re-exports) | Medium | Maintain compatibility re-exports |
| xstate machine coupling with session | Low | Can be refactored incrementally |

---

## Decisions

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-01-06 | Create `ports/` for interfaces, `contracts/` for schemas | Clear separation: ports = DI interfaces, contracts = data shapes |
| 2026-01-06 | Factory pattern `createRouter(ctx)` | Eliminates global state, enables testing, clean dependency flow |
| 2026-01-06 | Keep compatibility wrappers during migration | Prevents big-bang, allows incremental adoption |

---

## Change Log

### 2026-01-06 23:30 - Milestone 1 Complete: Contracts Layer Foundation
- **Summary**: Created ports/ and contracts/events/ directories with extracted interfaces
- **Scope**: packages/shared
- **Files Created**:
  - `src/ports/index.ts` - Port interface exports
  - `src/ports/agent-manager.ts` - IAgentManager interface
  - `src/ports/store.ts` - IStore re-export
  - `src/ports/worktree-manager.ts` - IWorktreeManager re-export
  - `src/ports/native-dialog.ts` - INativeDialog interface
  - `src/ports/dev-server-service.ts` - IDevServerService interface
  - `src/ports/web-server-service.ts` - IWebServerService interface
  - `src/ports/handover-service.ts` - IHandoverService interface
  - `src/ports/gtr-config-service.ts` - IGtrConfigService interface
  - `src/contracts/index.ts` - Contracts entry point
  - `src/contracts/events/index.ts` - Typed session events
- **Commit ID**: (pending)
- **Next Move**: Implement createRouter(ctx) factory (Milestone 2)

### 2026-01-06 23:45 - Milestone 2 Complete: createRouter Factory
- **Summary**: Created factory-based router that accepts RouterContext instead of global DI
- **Scope**: packages/shared
- **Files Created/Modified**:
  - `src/router/createRouter.ts` - Factory function with RouterContext interface
  - `src/router/index.ts` - Added createRouter export, deprecated appRouter
  - `src/index.ts` - Added exports for createRouter, RouterContext, ports, contracts
- **Pattern Established**:
  - RouterContext interface defines all service dependencies
  - createRouter(ctx) builds router with explicit dependencies
  - Legacy global DI (setAgentManager, etc.) still works for transition
  - Internal _setRouterContext bridges legacy handlers during migration
- **Commit ID**: (pending)
- **Next Move**: Build ctx in electron, move oRPC to adapters (Milestone 3)

### 2026-01-07 02:15 - Milestone 3 Complete: oRPC Adapters Wired
- **Summary**: Completed oRPC adapter migration, router now flows from bootstrap to all consumers
- **Scope**: packages/electron
- **Files Created/Modified**:
  - `src/adapters/orpc/orpc-adapter.ts` - New adapter with UpgradableServer interface
  - `src/adapters/orpc/index.ts` - Re-exports adapter functions
  - `src/server/web-server.ts` - Updated to accept router parameter
  - `src/services/web-server-manager.ts` - Added setRouter() method
  - `src/main.ts` - Added webServerManager.setRouter(router) wiring
- **Files Deleted**:
  - `src/server/orpc-server.ts` - Old file, replaced by adapters/orpc
- **Architecture Established**:
  - Bootstrap creates router and wires to all adapters
  - webServerManager.setRouter(router) called before server starts
  - UpgradableServer interface supports both HTTP and HTTP/2 servers
- **Commit ID**: (pending)
- **Next Move**: Move shared/services into electron (Milestone 4)

### 2026-01-08 04:53 - Milestone 4 Progress: RulesResolver Port & Implementation
- **Summary**: Created IRulesResolver port interface and electron implementation
- **Scope**: packages/shared (ports), packages/electron (application/services)
- **Files Created**:
  - `packages/shared/src/ports/rules-resolver.ts` - IRulesResolver interface
  - `packages/electron/src/application/services/rules-resolver.ts` - Implementation
  - `packages/electron/src/application/services/index.ts` - Service exports
  - `packages/electron/src/application/index.ts` - Application layer exports
- **Files Modified**:
  - `packages/shared/src/ports/index.ts` - Added IRulesResolver export
  - `packages/shared/src/router/createRouter.ts` - Added rulesResolver to RouterContext
  - `packages/electron/src/app/bootstrap.ts` - Creates and wires rulesResolver
  - `packages/shared/src/services/rules-resolver.ts` - Added deprecation notices
- **Pattern Established**:
  - Port interface in shared/ports (IRulesResolver)
  - Implementation in electron/application/services (createRulesResolver)
  - Bootstrap creates service and adds to RouterContext
  - Legacy code marked @deprecated with migration path
- **Commit ID**: (pending)
- **Next Move**: Migrate router handlers to use ctx.rulesResolver

### 2026-01-08 05:18 - Bootstrap uses createRouter(ctx), first handler migrated
- **Summary**: Fixed bootstrap to use createRouter(ctx) instead of legacy appRouter, enabling getRouterContext() to work. Migrated conversations.ts to use ctx.rulesResolver.
- **Scope**: packages/electron, packages/shared
- **Files Modified**:
  - `packages/electron/src/app/bootstrap.ts` - Now calls createRouter(ctx) instead of using appRouter
  - `packages/electron/src/main.ts` - Added AppRouter import and casts for router
  - `packages/electron/src/adapters/orpc/orpc-adapter.ts` - Updated to use ConstructorParameters<WSRPCHandler> type
  - `packages/electron/src/services/web-server-manager.ts` - Added AnyAppRouter type
  - `packages/electron/src/server/web-server.ts` - Added AnyAppRouter type
  - `packages/shared/src/router/conversations.ts` - Migrated to use getRouterContext().rulesResolver
- **Key Fix**: createRouter(ctx) internally calls _setRouterContext(ctx), which enables handlers to call getRouterContext() during the transition period
- **Commit ID**: (pending)
- **Next Move**: Continue migrating other handlers, move model-fetcher.ts to electron

### 2026-01-08 05:45 - All router handlers migrated to getRouterContext()
- **Summary**: Completed migration of all 14 router handler files from global DI (getStoreOrThrow, getAgentManagerOrThrow, etc.) to getRouterContext() pattern
- **Scope**: packages/shared/src/router/*
- **Files Modified**:
  - `agents.ts` - Migrated to ctx.agentManager, ctx.store, ctx.nativeDialog, ctx.worktreeManager
  - `api-settings.ts` - Migrated to ctx.store
  - `app-settings.ts` - Migrated to ctx.store
  - `approvals.ts` - Migrated to ctx.store, ctx.agentManager
  - `conversations.ts` - Fully migrated to ctx (store, agentManager, rulesResolver, handoverService)
  - `dev-server.ts` - Migrated to ctx.agentManager, ctx.store, ctx.devServerService
  - `locks.ts` - Migrated to ctx.store
  - `mcp.ts` - Migrated to ctx.agentManager
  - `models.ts` - Migrated to ctx.store
  - `projects.ts` - Migrated to ctx.store, ctx.gtrConfigService
  - `worktrees.ts` - Migrated to ctx.store, ctx.worktreeManager
- **Pattern Used**: `const ctx = getRouterContext();` at start of each handler
- **Remaining Work**: model-fetcher.ts and session-builder.ts still use global DI internally (not via router)
- **Commit ID**: (pending)
- **Next Move**: Move model-fetcher.ts implementation to electron

### 2026-01-06 23:00 - Initial Setup
- **Summary**: Created `Refactor.md` with full milestone plan
- **Scope**: Repository root (documentation only)
- **Commit ID**: (pending)
- **Next Move**: Create contracts/ports/events directories in shared (Milestone 1)

### 2026-01-08 06:20 - Milestone 4 Complete: Cleaned Shared Services
- **Summary**: Completed migration of shared services to electron and cleaned up shared package
- **Scope**: packages/shared, packages/electron
- **Files Deleted**:
  - `packages/shared/src/services/session-builder.ts` (Dead code)
  - `packages/shared/src/services/rules-resolver.ts` (Replaced by rules-service)
- **Files Modified**:
  - `packages/shared/src/services/model-fetcher.ts` (Removed implementation, kept pure utils)
  - `packages/shared/src/services/dependency-container.ts` (Deprecated, thinned, imports from ports)
  - `packages/shared/src/router/rules.ts` (Refactored to use ctx.rulesService, removed FS access)
  - `packages/shared/src/router/projects.ts` (Removed unused rules generation FS logic)
  - `packages/shared/src/ports/rules-service.ts` (Created IRulesService with CRUD)
  - `packages/electron/src/application/services/rules-service.ts` (Implemented RulesService)
  - `packages/electron/src/app/bootstrap.ts` (Wired RulesService)
- **Key Achievement**: Shared package is now much closer to "contracts only". FS access removed from shared router.
- **Commit ID**: (pending)

### 2026-01-08 06:40 - Milestone 5 Progress: Split Agents Layer
- **Summary**: Split `electron/src/agents/` into Application and Infrastructure layers
- **Scope**: packages/electron
- **Files Moved**:
  - `agents/drivers/*` → `infrastructure/agent-drivers/*`
  - `agents/process-utils.ts` → `infrastructure/agent-drivers/process-utils.ts`
  - `agents/driver-resolver.ts` → `infrastructure/agent-drivers/driver-resolver.ts`
  - `agents/*` (managers, machines, builders) → `application/sessions/*`
- **Refactoring**:
  - Updated 10+ files to point to new locations
  - Fixed internal imports within the new layers
- **Commit ID**: (pending)
- **Next Move**: Move store/ to infrastructure/store/

### 2026-01-08 07:00 - Milestone 5 Complete: Layer Separation
- **Summary**: Completed layer separation in electron, establishing clear Application vs Infrastructure boundaries
- **Scope**: packages/electron
- **Files Moved**:
  - `store/` → `infrastructure/store/`
  - `server/mcp-*` and `server/tools/` → `infrastructure/mcp/`
  - `main/worktree-manager.ts` → `infrastructure/worktree/`
  - `main/dev-server-manager.ts` → `infrastructure/dev-server/`
  - `main/agent-logs.ts` → `infrastructure/logging/`
  - `main/ipc.ts` → `infrastructure/ipc/`
  - `main/theme.ts` → `infrastructure/desktop/`
  - `main/native-dialog.ts` → `infrastructure/desktop/` (missing in prev command but noted in plan)
- **Architecture Established**:
  - `application/`: Pure business logic (Sessions, Services)
  - `infrastructure/`: External implementations (Store, MCP, Git, Electron IPC, Desktop integration)
  - `adapters/`: Protocol adapters (oRPC, IPC)
- **Commit ID**: (pending)
- **Next Move**: Milestone 6 - Unify Session Runtime with typed events

### 2026-01-08 07:10 - Milestone 6 Progress: Typed Events Foundation
- **Summary**: Verified M6 foundation is in place, fixed TypeScript error, updated documentation
- **Scope**: packages/electron, Refactor.md
- **Status Check**:
  - `AgentOutputParser` emits `SessionEvent[]` (LogEvent, ToolCallEvent, etc.) ✅
  - `OneShotSession` emits typed events via `emit("session-event", event)` ✅
  - `ParsedLog` type removed, replaced with `ParseResult` ✅
  - UI still uses legacy `onAgentLog` pattern (needs update)
- **Files Modified**:
  - `packages/electron/src/application/sessions/index.ts` - Fixed export (ParsedLog→ParseResult)
- **Next Move**: Emit SessionLifecycleEvent from xstate transitions, update UI to consume typed events

### 2026-01-08 07:15 - Milestone 6 Progress: Typed State & Lifecycle Events
- **Summary**: Added typed event emission for xstate state changes and session lifecycle events
- **Scope**: packages/electron/src/application/sessions/one-shot-session.ts
- **Changes**:
  - Added `StateChangeEvent` and `SessionLifecycleEvent` imports
  - xstate `actor.subscribe()` now emits `StateChangeEvent` via `session-event` channel
  - Added `emitLifecycleEvent(action, reason)` helper method
  - Emit `started` lifecycle event when process begins
  - Emit `stopped` lifecycle event when user stops generation
  - Emit `reset` lifecycle event on config/agent type changes
- **Event Flow**:
  ```
  OneShotSession
    └→ actor.subscribe() → StateChangeEvent
    └→ processMessage() → SessionLifecycleEvent("started")
    └→ stop() → SessionLifecycleEvent("stopped")
    └→ resetState*() → SessionLifecycleEvent("reset")
    └→ parseStreamJson() → LogEvent, ToolCallEvent, etc.
  ```
- **Backward Compatibility**: Legacy `state-changed` event still emitted alongside typed events
- **Next Move**: Update UI to consume SessionEvent types, add onSessionEvent to preload
