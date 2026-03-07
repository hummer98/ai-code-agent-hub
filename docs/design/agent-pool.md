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

## リポジトリ自動 clone (FR-011)

`getOrStart(repoName)` の中で Agent プロセス起動前に `ensureCloned()` を呼び出す。

### フロー

```
getOrStart(repoName)
  → ensureCloned(repoName, repoPath)
    → pathExists(repoPath) で存在チェック
      → 存在する → skip
      → 存在しない → cloneRepo()
        → git clone {url} {repoPath}
  → agent.startProcess(repoPath)
```

### clone URL 生成

`AgentPool.buildCloneUrl(repoName, token?)` で生成。

- GITHUB_TOKEN なし: `https://github.com/{repoName}.git`
- GITHUB_TOKEN あり: `https://{token}@github.com/{repoName}.git`

### 重複 clone 防止

`cloneInFlight: Map<string, Promise<void>>` で同一リポジトリへの並行 clone をデデュプリケーションする。2 つ目以降のリクエストは既存の Promise を await して完了を待つ。clone 完了/失敗後に Map から削除される。

### エラー処理

- clone 失敗時は `Failed to clone {repoName}: {message}` 形式のエラーをスローする
- エラーメッセージ中の GITHUB_TOKEN は `***` に置換してログ漏洩を防止する

### 環境変数

| 変数 | 用途 | デフォルト |
|------|------|-----------|
| `GITHUB_TOKEN` | プライベートリポジトリ clone 用 PAT | (なし = public のみ) |
| `HUB_REPOS_PATH` | clone 先ベースディレクトリ | `/repos` |

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
              AgentPool --> ensureCloned() --> git clone (execFile)
              AgentPool --> Agent.startProcess(repoPath)
```

## 見積もり

~180行
