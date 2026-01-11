# @agent-manager/shared

`shared` パッケージは、アプリケーションの「契約（Contract）」レイヤーです。Electron バックエンドと Web フロントエンドの間で共有されるすべての定義が含まれています。

## API ルーター (`src/router`)

このアプリケーションは [oRPC](https://orpc.unnoq.com/) を使用して、型安全な API を提供しています。

### `createRouter(ctx)`
ルーターを作成するためのファクトリ関数です。依存関係注入（DI）コンテナとして機能する `RouterContext` を受け取ります。

```typescript
import { createRouter } from '@agent-manager/shared/router/createRouter';

// コンテキスト（依存関係）の定義
const ctx: RouterContext = {
  agentManager: myAgentManager,
  store: myStore,
  worktreeManager: myWorktreeManager,
  // ...そのほかのサービス
};

// ルーターの作成
const appRouter = createRouter(ctx);
```

### 利用可能なルーター
*   **`projects`**: プロジェクトの作成、一覧取得、削除。
*   **`conversations`**: チャット履歴の管理、メッセージ送信。
*   **`agents`**: エージェントセッションの開始、停止。
*   **`worktrees`**: ファイル操作、Git 操作。
*   **`mcp`**: MCP サーバーの管理。
*   **`settings`**: アプリケーション設定。

## ポート (Ports) (`src/ports`)

ヘキサゴナルアーキテクチャに基づき、ビジネスロジックが必要とする「機能」をインターフェースとして定義しています。
実装は `packages/electron` にあります。

| インターフェース | 説明 |
| :--- | :--- |
| **`IAgentManager`** | エージェントセッションのライフサイクル管理。 |
| **`IStore`** | データの永続化（Projects, Conversations, Settings）。 |
| **`IWorktreeManager`** | ユーザーのコードベースに対するファイル操作。 |
| **`IWebServerService`** | 内部 Web サーバーの制御。 |
| **`INativeDialog`** | OS ネイティブのダイアログ表示（ファイル選択など）。 |

## イベント契約 (`src/contracts/events`)

エージェントの実行中に発生するイベントは、判別共用体（Discriminated Union）である `SessionEvent` として定義されています。

### `SessionEvent`
すべてのイベントは以下の基本構造を持ちます：
```typescript
interface BaseEvent {
  id: string;        // 一意なイベントID
  timestamp: string; // ISO タイムスタンプ
  sessionId: string; // 所属するセッションID
}
```

### イベントタイプ
*   **`log`**: エージェントからのテキストログ出力。
*   **`tool-call`**: エージェントがツール（MCP ツールなど）を実行しようとしている。
*   **`tool-result`**: ツールの実行結果。
*   **`thinking`**: エージェントの思考プロセス（CoT）。
*   **`state-change`**: ステートマシンの状態遷移（例: `idle` -> `running`）。
*   **`error`**: エラー発生。
*   **`session-lifecycle`**: セッションの開始、停止、一時停止など。

## 型定義 (`src/types`)

アプリケーション全体で使用されるドメインオブジェクトの定義です。
*   `AgentConfig`: エージェントの設定。
*   `Project`: プロジェクトのメタデータ。
*   `GtrConfig`: `.gtrconfig` ファイルの設定構造。
