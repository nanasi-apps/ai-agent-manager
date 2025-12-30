# Architecture Documentation

## Overview

Agent Manager is a monorepo containing an Electron application for orchestrating AI agents using the Model Context Protocol (MCP).

### High-Level Structure

- **`packages/electron`**: The backend (Main Process). Handles agent execution, file system operations, and Git Worktrees.
- **`packages/web`**: The frontend (Renderer Process). A Vue 3 application built with Vite.
- **`packages/shared`**: Shared TypeScript definitions and the **oRPC Router** implementation.

---

## Agent Architecture

The core logic resides in `packages/electron/src/agents`. It follows a layered architecture:

### 1. UnifiedAgentManager (`unified-agent-manager.ts`)
The main entry point for the application. Currently, it acts as a **proxy** to the `OneShotAgentManager`. It exists to allow future extensibility (e.g., routing specific requests to different managers) without changing the consumer API.

### 2. OneShotAgentManager (`oneshot-agent-manager.ts`)
Manages a collection of **OneShotSessions**. It handles:
- Creating/destroying sessions.
- Routing messages to specific sessions.
- Listing active sessions.

### 3. OneShotSession (`one-shot-session.ts`)
The "brain" of a single agent. It encapsulates:
- **State Management**: Uses `xstate` (`machines/agent-machine.ts`) to manage the lifecycle (Idle -> Processing -> Paused).
- **Process Management**: Spawns and kills the underlying CLI process (e.g., `gemini-cli`, `claude`).
- **Worktree Handling**: Manages the complex logic of pausing an agent, switching the Git Worktree (directory), and resuming the agent in the new context.

### 4. Drivers (`drivers/`)
Abstraction layer for different AI CLI tools.
- `GeminiDriver`: Formats commands/envs for Google Gemini.
- `ClaudeDriver`: Formats commands/envs for Anthropic Claude.
- `CodexDriver`: Formats commands/envs for OpenAI Codex.

---

## Communication (oRPC)

The app uses **oRPC** for type-safe communication between `web` and `electron`.

1. **Definition**: The API is defined *and implemented* in `packages/shared/src/router`.
2. **Dependency Injection**: The router in `shared` imports interfaces. The implementation is injected at runtime by `packages/electron/src/main.ts` using `setAgentManager`, `setStore`, etc.
3. **Transport**: Electron's `MessagePort` is used as the transport layer.

## Key Concepts

- **Worktree Isolation**: Each agent can run in a separate Git Worktree. The `OneShotSession` handles the directory switching transparently.
- **MCP Host**: The Electron app acts as an MCP Host, exposing tools to the agents via a local server (`packages/electron/src/server/mcp-server.ts`).
