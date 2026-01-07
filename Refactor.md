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

### Milestone 4: Move shared/services into electron
- [ ] Create destination: `electron/src/application/services/`
- [ ] Move `model-fetcher.ts`
- [ ] Move `rules-resolver.ts`
- [ ] Move `session-builder.ts`
- [ ] Delete/thin `dependency-container.ts` (leave explicit TODOs)

### Milestone 5: Layer separation in electron
- [ ] Split `agents/` → `application/sessions/` + `infrastructure/agent-drivers/`
- [ ] Move `server/mcp-*` → `infrastructure/mcp/`
- [ ] Move `server/orpc-*` → `adapters/orpc/`
- [ ] Move `store/` → `infrastructure/store/`
- [ ] Split `main/*` → `infrastructure/electron/` + `application/services/`

### Milestone 6: Unify Session Runtime with typed events
- [ ] Convert output-parser to emit typed events (not strings)
- [ ] UI subscribes to typed events (ansi_up stays in UI)
- [ ] Link session state transitions (xstate) with events

---

## Current Status

**Date**: 2026-01-07 02:15  
**Phase**: Milestone 4 - Move shared/services into electron

### Milestone 3 Complete! ✅

All oRPC adapters are now properly wired:
- Electron IPC: `main.ts` → `bootstrap()` → `setupElectronOrpc(router)`
- Web Server: `main.ts` → `webServerManager.setRouter(router)` → `startWebServer(port, host, router)`
- Old `server/orpc-server.ts` deleted - no longer needed

### Current Architecture Analysis:

**packages/shared/src/services/** (PROBLEM: Milestone 4 target):
- `dependency-container.ts` - Global DI with setters/getters (255 lines)
- `model-fetcher.ts` - Model fetching logic
- `rules-resolver.ts` - Rules resolution logic  
- `session-builder.ts` - Session building logic

**packages/shared/src/router/** (PARTIAL: factory exists, legacy still used):
- `createRouter.ts` - Factory function accepting RouterContext ✅
- 14 sub-router files still use global DI internally
- `_setRouterContext()` bridges legacy handlers during transition

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

1. **Create application/services directory** - Prepare for Milestone 4
   - Create `packages/electron/src/application/` directory
   - Create `packages/electron/src/application/services/` directory

2. **Move model-fetcher.ts** - First service to move
   - Copy `packages/shared/src/services/model-fetcher.ts` to electron
   - Update imports in shared to point to new location (thin wrapper)
   - Add explicit TODO to remove shared wrapper

3. **Move rules-resolver.ts** - Second service
   - Similar process to model-fetcher

4. **Move session-builder.ts** - Third service
   - Similar process

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

### 2026-01-06 23:00 - Initial Setup
- **Summary**: Created `Refactor.md` with full milestone plan
- **Scope**: Repository root (documentation only)
- **Commit ID**: (pending)
- **Next Move**: Create contracts/ports/events directories in shared (Milestone 1)
