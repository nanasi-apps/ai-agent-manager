# @agent-manager/web

`packages/web` は、Vue 3 で構築されたフロントエンドアプリケーションです。

## ステート管理 (Pinia)

アプリケーションの状態は `src/stores` で管理されています。最も重要なのは `ConversationStore` です。

### `ConversationStore` (`conversation.ts`)
チャットセッションの全状態を管理します。

*   **状態**:
    *   `messages`: チャット履歴（ログ、ツールコール、思考プロセスを含む）。
    *   `modelIdDraft`: ユーザーが選択中のモデル。
    *   `isGenerating`: エージェントが実行中かどうか。
*   **アクション**:
    *   `sendMessage`: ユーザーメッセージを送信し、応答生成を開始。
    *   `swapModel`: 会話の途中で担当するエージェントモデルを切り替え。
    *   `appendAgentLog`: バックエンドから受信したストリームログをメッセージリストに結合。

## クライアントアーキテクチャ (`src/services/orpc.ts`)

フロントエンドは、環境に応じて通信路を自動的に切り替えます。

1.  **Electron モード**: `window.electronAPI` が検出された場合、`MessagePort` を使用してメインプロセスと直接通信します（ゼロレイテンシ、オーバーヘッドなし）。
2.  **Web モード**: Electron が検出されない場合（ブラウザでの開発時）、WebSocket (`ws://localhost:3002`) を使用してローカルサーバーに接続します。

## リアルタイム更新の仕組み

`ConversationView.vue` は、マウント時に以下のサブスクリプションを開始します：

```typescript
// エージェントのログイベント購読
const eventIterator = await orpc.electron.agent.subscribeEvents({});
for await (const event of eventIterator) {
    if (event.type === 'log') {
        store.appendAgentLog(event.payload);
    }
}

// エージェントの状態変更購読
const stateIterator = await orpc.electron.agent.subscribeState({});
for await (const state of stateIterator) {
    // UI のビジー状態などを更新
}
```

これにより、ポーリングなしでエージェントの思考やツール実行の様子がリアルタイムに UI に反映されます。
