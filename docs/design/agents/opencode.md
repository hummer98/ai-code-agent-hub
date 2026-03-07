# OpenCode Agent 詳細設計

## 対応要求

- [FR-006](../requirements/README.md) マルチエージェント
- [FR-007](../requirements/README.md) Agent プロセス管理
- [FR-012](../requirements/README.md) ストリーミング応答
- [NFR-008](../requirements/README.md) Worktree セッション分離

## 責務

`@opencode-ai/sdk` の `createOpencodeServer()` で Agent プロセスを起動・管理する Agent 実装。

## プロセス起動

```typescript
import { createOpencodeServer, createOpencodeClient } from "@opencode-ai/sdk"

// サーバー起動 (child_process.spawn 不要)
const server = await createOpencodeServer({ port, hostname: "127.0.0.1" })
const client = createOpencodeClient({ baseUrl: server.url })

// 停止
server.close()
```

### 設計変更理由

seed では `child_process.spawn("opencode", ["serve", ...])` でプロセスを起動する想定だったが、
SDK 調査 (v1.2.21) で `createOpencodeServer()` が提供されていることが判明。
プロセス管理がよりクリーンになり、死活チェックも簡素化されるため SDK API を採用する。

## AgentProcess 実装

`@opencode-ai/sdk` の `OpencodeClient` を介してセッションを操作する。

| メソッド (AgentProcess) | SDK 呼び出し | 説明 |
|------------------------|-------------|------|
| `createSession()` | `client.session.create()` | 新規セッション作成 |
| `prompt(id, content)` | `client.session.prompt({ path: { id }, body: { content } })` | プロンプト送信 |
| `destroySession(id)` | `client.session.delete({ path: { id } })` | セッション破棄 |
| `alive()` | サーバーインスタンスの状態チェック | `createOpencodeServer` の返り値で管理 |

### resumeSession について

SDK (v1.2.21) に `resume` API は存在しない。opencode のセッションはサーバー側で永続化されるため、
既存の sessionId で `prompt()` を呼べば会話は継続される。AgentProcess インターフェースの
`resumeSession()` は no-op (何もしない) で実装する。

## ストリーミング応答 (FR-012)

`prompt()` は `AsyncIterable<string>` を返す。内部的には SDK の `client.session.prompt()` + `client.global.event()` (SSE) を組み合わせる。

```typescript
async *prompt(sessionId: string, content: string): AsyncIterable<string> {
  // 1. client.global.event() で SSE ストリームを購読
  // 2. client.session.prompt({ path: { id: sessionId }, body: { content } })
  // 3. SSE イベントからセッション対象のメッセージを yield
}
```

Router はこのイテレータを消費してチャンク単位で Platform に中継する。

## Worktree セッション分離 (NFR-008)

opencode-worktree プラグイン (`kdco/worktree`) を利用して、セッション毎に独立した作業ディレクトリを提供する。
Dockerfile で `npx ocx add kdco/worktree` によりインストール済み。

### フロー

1. `createSession()` 時にプラグインが `git worktree add` を実行
2. 各セッションが独立ディレクトリで作業 (コンフリクトなし)
3. `destroySession()` 時にプラグインが auto-commit → worktree 削除

### プラグイン設定 (`.opencode/worktree.jsonc`)

```jsonc
{
  "sync": {
    "copyFiles": [".env", ".env.local"],
    "symlinkDirs": ["node_modules"]
  }
}
```

詳細は seed ドキュメント `docs/seeds/multi-claude-code-webui.md` の Worktree セクションを参照。

## SDK

`@opencode-ai/sdk` を使用してプログラマティックに制御する。

```typescript
import { createOpencodeClient } from "@opencode-ai/sdk"
const client = createOpencodeClient({ baseUrl: `http://localhost:${port}` })
```

## 見積もり

~60行
