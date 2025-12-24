# Agent Manager - 決定事項まとめ

*最終更新: 2025-12-25*

---

## 📋 目次
1. [確定事項](#確定事項)
2. [技術スタック](#技術スタック)
3. [ライブラリ候補（ANSI処理）](#ライブラリ候補ansi処理)
4. [ライブラリ候補（依存関係グラフ・静的解析）](#ライブラリ候補依存関係グラフ静的解析)
5. [アーキテクチャ：Electron + ブラウザ共有](#アーキテクチャelectron--ブラウザ共有)
6. [スコープアウト（MVPでは除外）](#スコープアウトmvpでは除外)
7. [開発フェーズ](#開発フェーズ)
8. [実装進捗](#実装進捗)

---

## 確定事項

### ダッシュボード機能
| 項目 | 決定内容 |
|------|----------|
| **エージェント制御** | ダッシュボードから起動・停止可能、WebUI上からも操作可能 |
| **リソース監視** | エージェント単位で監視（リモートサーバー含む） |
| **Intent ロック** | 楽観的ロック、ファイル単位、タイムアウト1分 |

### エージェント画面
| 項目 | 決定内容 |
|------|----------|
| **stdio パース** | 全フォーマット対応（JSON Lines、プレーンテキスト、ANSI） |
| **stderr** | 表示対象 |
| **モデルホットスワップ** | エージェントに状態を出力させてから切り替え、Markdown形式でやりとり |
| **CLIツール認証** | ユーザー側で事前ログイン済みを前提、stdioで制御 |
| **APIキー管理** | 暗号化して保存 |

### Git Worktree 管理
| 項目 | 決定内容 |
|------|----------|
| **作成タイミング** | エージェント起動時 |
| **最大数** | 5個/リポジトリ |
| **自動クリーンアップ** | 検討対象（要実装） |
| **コミット粒度** | 1ファイルごと |
| **コミットメッセージ** | 自動生成 |
| **squash** | しない |
| **自動Rebase** | 実行する |
| **マージ優先順位** | 変更量が多い方を優先 |

### パッケージ管理
| 項目 | 決定内容 |
|------|----------|
| **対応PM** | pnpm のみ |
| **node_modules共有** | 基本共有、プロジェクトごとにオプトアウト可能 |

### ルール & MCP設定
| 項目 | 決定内容 |
|------|----------|
| **バージョン管理** | Git ベース |
| **ルールセット** | エージェントごとに異なるルールセット適用可能 |
| **即時反映** | 実行中のエージェントには即時反映されない |
| **同期バックエンド** | Workers WebAPI経由（自前構築） |
| **ツール権限管理** | あり |

### 通知
| 項目 | 決定内容 |
|------|----------|
| **チャネル** | Discord, Slack 対応 |
| **タイムアウト** | なし |
| **意思決定者** | 誰でもOK |

### スケーラビリティ
| 項目 | 決定内容 |
|------|----------|
| **最大エージェント数** | 20個（5個/プロジェクト×4プロジェクト想定）、後から拡張 |

---

## 技術スタック

### 確定
| レイヤー | 技術 |
|----------|------|
| **フレームワーク** | Vue.js 3 + Vite |
| **デスクトップ** | Electron（ゼロから構築） |
| **対象OS** | Windows, macOS, Linux |
| **言語** | TypeScript |
| **パッケージマネージャー** | pnpm |
| **UIコンポーネント** | Shadcn Vue |
| **IPC通信** | oRPC Electron Adapter |
| **Linting/Formatting** | Biome |
| **DB**（将来） | Cloudflare D1 |
| **バックエンド**（将来） | Cloudflare Workers |

### プロジェクト構成（現在）
```
agent-manager/
├── packages/
│   ├── shared/          # 共有型定義・oRPCルーター
│   ├── electron/        # Electron メインプロセス
│   └── web/             # Vue.js アプリケーション
│       ├── src/
│       │   ├── components/
│       │   │   ├── ui/          # Shadcn UIコンポーネント
│       │   │   ├── AppSidebar.vue
│       │   │   └── AppHeader.vue
│       │   ├── pages/           # ページコンポーネント
│       │   │   ├── index.vue    # Dashboard
│       │   │   ├── inbox.vue
│       │   │   ├── agents.vue
│       │   │   ├── settings.vue
│       │   │   ├── projects/
│       │   │   └── conversions/
│       │   ├── layouts/
│       │   ├── router/
│       │   ├── services/
│       │   └── styles/
│       └── ...
├── pnpm-workspace.yaml
├── biome.json
└── package.json
```

---

## ライブラリ候補（ANSI処理）

### CLIツールのstdio出力をパース→表示するためのライブラリ

| ライブラリ | 説明 | メリット | デメリット |
|------------|------|----------|------------|
| **ansi_up** | ANSIエスケープコード → HTML変換 | ブラウザ/Node.js両対応、積極的にメンテナンス | パース機能のみ、ターミナルエミュレーション不可 |
| **@ansi-tools/parser** | ANSI トークナイザー・パーサー | ゼロ依存、多種のコントロールコード対応、最新 | HTMLへの変換は自前実装必要 |
| **ansi-sequence-parser** | ANSIシーケンスを構造化データにパース | チャンク処理対応、状態保持可能 | 比較的新しく実績少なめ |
| **terminal.js** | ターミナルエミュレーター | カーソル移動・画面書き換えに対応 | 重い、オーバースペックの可能性 |
| **xterm.js** | フル機能ターミナルエミュレーター | 本格的なターミナル体験、VSCode採用 | サイズ大、設定複雑 |

### 🔵 推奨
- **シンプル表示**: `ansi_up`（ANSIコード → HTML変換が簡単）
- **高度なパース**: `@ansi-tools/parser` + 自前レンダリング
- **本格ターミナル**: `xterm.js`（VS Codeと同じ体験）

---

## ライブラリ候補（依存関係グラフ・静的解析）

### インパクト・アナライザー実装のためのTypeScript静的解析ツール

| ライブラリ | 説明 | メリット | デメリット |
|------------|------|----------|------------|
| **Dependency Cruiser** | 依存関係の可視化・検証ツール | JSON/DOT出力、循環依存検出、ルール定義可能 | 設定が複雑になりがち |
| **typescript-graph** | TSファイル依存関係の可視化CLIツール | メトリクス計測（Maintainability Index等）も可能 | CLI中心、ライブラリとしての利用は限定的 |
| **DecodeDeps** | import/require文から依存関係グラフ生成 | React/TS対応、循環依存検出 | 比較的新しい |
| **TypeScript Compiler API** | TS標準のAST解析API | 最も正確、公式サポート | 学習コスト高い |
| **@typescript-eslint/parser** | TS → ESTree AST変換 | ESLintエコシステムと連携、プレイグラウンドあり | 静的解析には追加実装が必要 |
| **madge** | 循環依存検出・依存グラフ生成 | シンプル、グラフ画像出力可能 | 古め、メンテナンス頻度低下 |

### 🔵 推奨
- **MVP用**: `Dependency Cruiser`（設定しやすく、JSON出力でフロントエンド統合が容易）
- **高度な分析**: TypeScript Compiler API（将来的に自前でAST解析）
- **可視化重視**: `madge` または `typescript-graph`

---

## アーキテクチャ：Electron + ブラウザ共有

### 構成図
```
┌─────────────────────────────────────────────────────────────┐
│                      packages/shared/                        │
│  ・型定義 (TypeScript types)                                 │
│  ・oRPC ルーター定義                                         │
│  ・ユーティリティ関数                                        │
└─────────────────────────────────────────────────────────────┘
                              ▲
              ┌───────────────┴───────────────┐
              │                               │
┌─────────────┴─────────────┐   ┌─────────────┴─────────────┐
│    packages/electron/     │   │      packages/web/        │
│  ・Electron メインプロセス │   │  ・Vue.js コンポーネント   │
│  ・oRPC サーバー           │   │  ・oRPC クライアント       │
│  ・preload スクリプト      │   │  ・Shadcn UI              │
└───────────────────────────┘   └───────────────────────────┘
```

### IPC通信設計（oRPC使用）
```typescript
// packages/shared/src/router.ts
import { os } from '@orpc/server'

export const router = os.router({
  ping: os.handler(() => 'pong'),
  // 追加のエンドポイントをここに定義
})

// packages/electron/src/main.ts
// oRPC Electron Adapter でサーバー起動

// packages/web/src/services/orpc.ts
// oRPC クライアントでRenderer→Main通信
```

---

## スコープアウト（MVPでは除外）

以下の機能はMVPでは実装しない：

| 機能 | 理由 |
|------|------|
| ❌ チェックポイント制御 | 設計を練り直す |
| ❌ 3-way Merge UI | 一旦不要 |
| ❌ クラウド同期の競合処理 | 考慮しない |
| ❌ オフライン動作 | 考慮しない |
| ❌ MCPサーバーの動的追加・削除 | 考慮しない |
| ❌ フォールバック処理 | 考慮しない |
| ❌ 認証・認可 | 今は不要 |
| ❌ マルチテナント | 今は不要 |

---

## 開発フェーズ

### Phase 1: Electronアプリケーション基盤 ✅ 完了
1. ✅ pnpm workspace セットアップ（monorepo構成）
2. ✅ Vue.js + Vite + Electron 統合（ゼロから構築）
3. ✅ 基本UIレイアウト（ダッシュボード、サイドバー）
4. ✅ Shadcn UI コンポーネント導入
5. ✅ oRPC Electron Adapter 統合
6. ✅ Biome 導入（リンティング・フォーマット）
7. ✅ ダークモード同期（OSテーマ連携）

### Phase 2: エージェント管理機能 🚧 進行中
1. ⬜ `child_process.spawn` によるCLIツール起動
2. ⬜ stdio パース（ANSI対応）→ リアルタイム表示
3. ⬜ エージェント起動・停止制御
4. ⬜ モデルホットスワップUI

### Phase 3: Git Worktree 管理
1. ⬜ Git Worktree 作成・削除機能
2. ⬜ マイクロコミット・ログ表示
3. ⬜ 自動Rebase実装
4. ⬜ コンフリクトシミュレーター（Dependency Cruiser連携）

### Phase 4: バックエンド開発
1. ⬜ Cloudflare Workers API 設計
2. ⬜ D1 データベーススキーマ
3. ⬜ Electron ↔ Workers 通信

### Phase 5: 結合・ブラウザ版
1. ⬜ Electron と Workers の結合
2. ⬜ ブラウザ版 UI（packages/web/）
3. ⬜ WebSocket によるリアルタイム同期

### Phase 6: 通知・オーケストレーション
1. ⬜ Discord/Slack Webhook 連携
2. ⬜ 意思決定チャットUI
3. ⬜ インパクト・アナライザー

---

## 実装進捗

### ✅ 完了した実装（2025-12-25現在）

| カテゴリ | 実装内容 |
|----------|----------|
| **プロジェクト構成** | pnpm monorepo (packages/shared, electron, web) |
| **UIフレームワーク** | Shadcn Vue コンポーネント群 |
| **サイドバー** | リサイズ可能、自動折りたたみ、ネスト構造対応 |
| **ナビゲーション** | Dashboard, Inbox, Search, Agents, Settings |
| **ページ** | index, inbox, agents, settings, projects/[id], conversions/[id] |
| **IPC通信** | oRPC Electron Adapter による型安全な通信 |
| **テーマ** | ダークモード（OS設定と同期） |
| **コード品質** | Biome によるリンティング・フォーマット |

### 🎯 次のアクション

1. **エージェント起動・停止機能の実装**
   - `child_process.spawn` でCLIツールを起動
   - oRPC経由でRenderer→Mainの制御

2. **stdio パース機能の実装**
   - ANSI対応のパーサー選定・導入
   - リアルタイムストリーミング表示

3. **エージェント一覧画面の実装**
   - 稼働状況の表示
   - 起動・停止ボタン
