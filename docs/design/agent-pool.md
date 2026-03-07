# Agent Pool 詳細設計

## 対応要求

- [FR-007](../requirements/README.md) Agent プロセス管理
- [FR-011](../requirements/README.md) リポジトリ自動 clone
- [NFR-003](../requirements/README.md) アイドルタイムアウト

## 責務

リポジトリ名をキーに Agent プロセスを管理する共有層。

- リポジトリの初回アクセス時に git clone + Agent プロセス起動
- 既存プロセスの再利用 (lastAccess 更新)
- アイドルタイムアウトによるプロセス停止 + ポート解放
- ポートの動的割当 (4097-4200)

## 状態管理

```typescript
Map<repoName, {
  process: AgentProcess
  port: number
  lastAccess: Date
}>
```

## ライフサイクル

```
初回アクセス
  → git clone https://github.com/{owner}/{repo} /repos/{repo}
  → agent.startProcess(repoPath)
  → Map に登録

再アクセス
  → Map から取得
  → lastAccess 更新
  → process.alive() が false なら再起動

アイドルタイムアウト (cleanup)
  → 定期実行 (setInterval)
  → now - lastAccess > timeoutMs のエントリを停止・削除

トピック変更 / 手動削除
  → プロセス停止
  → Map から削除
  → リポジトリ削除 (任意)
```

## ポート割当

- 範囲: 4097-4200
- 割当方式: AgentPool がポートを管理し、`Agent.startProcess(repoPath)` 呼び出し前にポートを割り当てる
- 割当ロジック: 解放済みポートのプール (freedPorts) を優先的に再利用し、空なら nextPort++ でインクリメント
- 解放: プロセス停止時にポートを freedPorts に戻す

※ ポート管理は Agent インターフェースの外側 (AgentPool) の責務。Agent.startProcess は repoPath のみを受け取る (seed の型定義に準拠)。
  AgentPool が内部的にポートを割り当て、Agent 実装の設定として渡す。

## 依存関係

```
Router  --->  AgentPool.getOrStart(repoName)
Portal  --->  AgentPool.getOrStart(repoName)
              AgentPool --> Agent.startProcess(repoPath)
```

## 見積もり

~100行
