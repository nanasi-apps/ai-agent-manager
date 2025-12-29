# Agent Manager

Agent Manager is a powerful orchestration dashboard designed to manage multiple AI agents working in parallel. It functions as an **MCP (Model Context Protocol) Host**, leveraging Git Worktrees to isolate agent contexts, preventing file conflicts and enabling efficient concurrent development.

## 🚀 Features

- **Centralized Dashboard**: Real-time monitoring of agent status, resource usage, and active tasks.
- **Multi-Agent Support**: Native support for **Gemini CLI**, **Claude Code**, and **OpenAI Codex** (via stdio integration).
- **Git Worktree Isolation**: Automatically manages Git Worktrees to allow multiple agents to work on different features on the same repository simultaneously.
- **MCP Host Architecture**: 
    - Acts as a central MCP Host connecting agents to tools.
    - Exposes Worktrees as MCP Resources (`mcp://worktree/{branch}`).
    - Provides tools for commit syncing, auto-rebasing, and conflict checking.
- **Agent Interface**:
    - Rich chat interface with ANSI support (stdio parsing).
    - **Model Hot-swapping**: Switch models (e.g., GPT-4 ⇄ Claude) mid-task with context handoff.
    - **Agent Handoff**: Summarizes context when switching agents.
- **Project Management**: 
    - Project-based organization.
    - Conversion linking.
- **Modern UI**: Dark mode support, Shadcn UI components, and resilient state management.

## 🛠 Tech Stack

- **Frontend**: Vue 3, Vite, Shadcn UI, Tailwind CSS
- **Desktop**: Electron
- **Communication**: oRPC (Type-safe IPC & WebSocket), MCP Protocol
- **Tooling**: Biome (Linting/Formatting), pnpm (Monorepo)

## 🏗 Architecture

The project is structured as a Monorepo:

- **packages/electron**: The main process (MCP Host, Agent Orchestrator).
- **packages/web**: The Vue 3 frontend dashboard.
- **packages/shared**: Shared types and oRPC definitions.

## 📦 Installation & Setup

### Prerequisites

- Node.js (v20+)
- pnpm
- `git-worktree-runner` (suggested for advanced worktree management)

### Installation

1. Clone the repository.
2. Install dependencies:
    ```bash
    pnpm install
    ```
3. Setup Git Worktree Runner:
    ```bash
    ./scripts/setup-gtr.sh
    ```

### Development

Start the development environment (Electron + Web in parallel):

```bash
pnpm dev
```

## 🗺 Roadmap

- [x] **Phase 1: Foundation**: Electron app, UI setup, oRPC integration.
- [x] **Phase 2: Agent Management**: CLI spawning, stdio parsing, Hot-swapping.
- [ ] **Phase 3: MCP Host & Worktrees**: Git Worktree tools, Resources, Orchestration (In Progress).
- [ ] **Phase 4: Backend**: Cloudflare Workers & D1 integration.