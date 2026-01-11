# コントリビューションガイド

Agent Manager プロジェクトへの貢献を歓迎します。

## 開発ワークフロー

1.  このリポジトリをフォークしてください。
2.  機能開発用の新しいブランチを作成してください (`git checkout -b feature/amazing-feature`)。
3.  変更をコミットしてください (`git commit -m 'Add some amazing feature'`)。
4.  ブランチにプッシュしてください (`git push origin feature/amazing-feature`)。
5.  プルリクエスト (Pull Request) を作成してください。

## コーディング規約 (Code Style)

このプロジェクトでは、コードの品質と一貫性を保つために **[Biome](https://biomejs.dev/)** を使用しています。

### ルールの遵守
コミットする前に必ず以下のコマンドを実行し、エラーがないことを確認してください。

```bash
pnpm check
```

フォーマットの自動修正が必要な場合は以下を実行してください。

```bash
pnpm check:fix
```

### TypeScript
*   `any` 型の使用は極力避けてください。
*   型定義は `packages/shared` または `packages/types` に配置し、再利用性を高めてください。
*   依存関係注入 (DI) を意識し、密結合を避けた設計を心がけてください。

## モノレポ構造

このプロジェクトは pnpm ワークスペースを使用しています。

*   **共有ロジック**: `packages/shared` に配置してください。
*   **Electron 固有**: `packages/electron` に配置してください。
*   **UI コンポーネント**: `packages/web` に配置してください。

各パッケージ間の依存関係は `pnpm-workspace.yaml` で管理されています。新しいパッケージを追加する場合は、適切に設定を行ってください。

## テスト

現在は大規模な自動テストスイートは整備中ですが、主要なロジックについては単体テストを書くことを推奨します。
