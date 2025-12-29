# Agent Manager

Agent Manager is a comprehensive dashboard and orchestration system designed to manage multiple AI agents working in parallel. It leverages Git Worktrees to isolate agent contexts, preventing file conflicts and enabling efficient concurrent development.

## 🚀 Features

- **Centralized Dashboard**: Real-time monitoring of agent status, resource usage (CPU/Memory), and task progress.
- **Agent Interface**: Interactive chat interface with support for model hot-swapping (GPT-4, Claude, etc.) and MCP (Model Context Protocol) tool visualization.
- **Git Worktree Management**: Automated handling of Git Worktrees to allow multiple agents to work on different tasks simultaneously without stepping on each other's toes.
- **Rules & MCP Configuration**: Manage system prompts, agent personalities, and MCP server connections.
- **Conflict Resolution**: Tools to analyze dependencies and resolve logical conflicts between agent tasks.

## 🏗 Architecture

This project is a monorepo managed by **pnpm**, consisting of:

- **packages/electron**: The main process application (Electron).
- **packages/web**: The frontend user interface (Vue 3 + Vite).
- **packages/shared**: Shared types and utilities.

## 🛠 Getting Started

### Prerequisites

- Node.js (v20+ recommended)
- pnpm

### Installation

```bash
pnpm install
```

### Development

To start the development environment (Electron + Web):

```bash
pnpm dev
```

## 📂 Project Structure

```
├── packages/
│   ├── electron/    # Electron main process
│   ├── web/         # Vue 3 frontend
│   └── shared/      # Shared code
├── scripts/         # Helper scripts
└── ...
```
