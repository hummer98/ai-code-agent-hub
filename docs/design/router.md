# Router 詳細設計

## 対応要求

- [FR-001](../requirements/README.md) マルチリポジトリ
- [FR-002](../requirements/README.md) マルチセッション
- [FR-012](../requirements/README.md) ストリーミング応答

## 責務

Platform からの `IncomingMessage` を受け取り、以下を実行する:

1. `repoHint` から Agent Pool 経由で AgentProcess を取得
2. `threadId` から Session Pool 経由でセッションを取得 (なければ作成)
3. `content` を AgentProcess に送信
4. 応答ストリーム (`AsyncIterable<string>`) を Platform 経由でユーザに逐次返信

## 依存関係

```
Platform --IncomingMessage--> Router ---> AgentPool.getOrStart(repoHint)
                                     +-> SessionPool.getOrCreate(threadId)
                                     +-> AgentProcess.prompt(sessionId, content)
                              Router ---> Platform.reply(msg, response)
```

Router は Platform と Agent の **具象を知らない** (Interface のみ依存)。

## メッセージフロー

### 新規メッセージ (スレッドなし)

1. Platform が `onMessage` ハンドラに `IncomingMessage` を渡す
2. Router が `Platform.startThread()` でスレッドを作成
3. `AgentPool.getOrStart(repoHint)` で AgentProcess 取得
4. `AgentProcess.createSession()` でセッション作成
5. `SessionPool` に `threadId → sessionId` を登録
6. `AgentProcess.prompt()` でストリーム取得 (`AsyncIterable<string>`)
7. ストリームのチャンクを収集しながら `Platform.reply()` で逐次返信

### 継続メッセージ (スレッドあり)

1. `SessionPool.get(threadId)` で既存セッション ID を取得
2. セッションが休止中なら `AgentProcess.resumeSession(sessionId)`
3. `AgentProcess.prompt()` でストリーム取得
4. ストリームのチャンクを収集しながら `Platform.reply()` で逐次返信

### ストリーミング中継 (FR-012)

`AgentProcess.prompt()` は `AsyncIterable<string>` を返す (seed の型定義)。
Router はこのストリームを消費しながら Platform に中継する。

```
AgentProcess.prompt(sessionId, content)
  → AsyncIterable<string> (SSE チャンク)
    → チャンクを一定量バッファリング
    → Platform.reply() で逐次送信
    → 完了後、最終メッセージを送信
```

Discord/Slack はメッセージ編集 API でストリーミング風の表示を実現する:
- 初回: 空メッセージを投稿して messageId を取得
- チャンク受信ごと: メッセージを編集 (edit) して内容を追記
- 完了: 最終編集で確定

## エラーハンドリング

- `repoHint` が未設定 → Platform 経由でエラーメッセージを返信
- AgentProcess の起動失敗 → エラーメッセージ返信 + ログ出力
- セッション復帰失敗 → 新規セッションを作成してフォールバック

## 見積もり

~100行
