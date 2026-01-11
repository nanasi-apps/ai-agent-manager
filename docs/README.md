# Agent Manager ドキュメント

Agent Manager のドキュメントへようこそ。このプロジェクトは、AI エージェントを管理・実行するための Electron アプリケーションを含むモノレポです。
Model Context Protocol (MCP) を活用し、拡張性の高いエージェント基盤を提供します。

## アーキテクチャ概要

### ハイレベル構造

このプロジェクトは pnpm モノレポとして構成されています。

*   **[`packages/electron`](./electron/README.md)**:
    *   **バックエンド (Main Process)**: エージェントの実行、ファイルシステム操作、Git ワークツリー管理を担当します。
    *   **ヘキサゴナルアーキテクチャ**: ビジネスロジックとインフラストラクチャが分離されています。
*   **[`packages/web`](./web/README.md)**:
    *   **フロントエンド (Renderer Process)**: Vue 3 + Vite で構築された UI です。
    *   **oRPC クライアント**: Electron バックエンドと型安全に通信します。
*   **[`packages/shared`](./shared/README.md)**:
    *   **契約 (Contracts)**: API ルーター定義、型定義、サービスインターフェース（ポート）を共有します。

### データフロー図

```mermaid
graph TD
    User[ユーザー] --> Web[Frontend (Vue 3)]
    
    subgraph "Renderer Process"
        Web --> Client[oRPC Client]
    end

    subgraph "Main Process (Electron)"
        Client -- MessagePort --> Router[oRPC Router]
        Router --> Service[Application Services]
        
        Service --> Session[Session Manager]
        Service --> Store[File Store]
        
        Session --> AgentMachine[Agent State Machine (XState)]
        AgentMachine --> Driver[Agent Driver]
    end

    subgraph "External Process"
        Driver -- spawn --> CLI[Agent CLI (Gemini/Claude/etc)]
    end

    CLI -- stdio --> Driver
```

## 主要な概念

### 1. ワークツリー分離 (Worktree Isolation)
各エージェントは独立した Git ワークツリーで実行することができます。これにより、ユーザーの作業中コードを汚すことなく、エージェントがバックグラウンドでコーディングタスクを行うことが可能です。

### 2. MCP ホスト
Electron アプリケーションは MCP ホストとして機能し、ローカルサーバー (`packages/electron/src/server/mcp-server.ts`) を介してエージェントにツールを提供します。

### 3. 型安全な通信 (oRPC)
Web と Electron 間の通信は完全に型安全です。`packages/shared` で定義された API ルーターが実装と消費の両方で使用されます。

## 開発セットアップ (Development Setup)

### 前提条件
*   Node.js (v20以上推奨)
*   pnpm (v9以上)

### インストール

```bash
# リポジトリのクローン
git clone https://github.com/your-org/agent-manager.git
cd agent-manager

# 依存関係のインストール
pnpm install
```

### 開発サーバーの起動

```bash
# すべてのパッケージ（Web, Electron, Shared）を並列でウォッチモードで起動
pnpm dev
```
これにより、Electron アプリが立ち上がります。

### コード品質ツール

このプロジェクトでは [Biome](https://biomejs.dev/) を使用してリンティングとフォーマットを行っています。

```bash
# チェック (Lint & Format check)
pnpm check

# 自動修正 (Apply fixes)
pnpm check:fix
```

---

## パッケージドキュメント

より詳細な情報は各パッケージのドキュメントを参照してください。

*   👉 **[Shared Package](./shared/README.md)**: API定義、型、イベント。
*   👉 **[Electron Package](./electron/README.md)**: アーキテクチャ詳細、セッションライフサイクル。
*   👉 **[Web Package](./web/README.md)**: UI アーキテクチャ、ストア管理。
*   👉 **[Types Package](./types/README.md)**: 低レベル型定義。

## コントリビューション

開発に参加する場合のガイドラインについては **[CONTRIBUTING.md](./CONTRIBUTING.md)** を参照してください。
