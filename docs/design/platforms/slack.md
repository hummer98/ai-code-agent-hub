# Slack Platform 詳細設計

## 対応要求

- [FR-004](../requirements/README.md) Slack 連携

## 責務

Slack Socket Mode (WebSocket) を介してメッセージを送受信する Platform 実装。

## 接続方式

- Socket Mode (WebSocket) — アウトバウンド接続、トンネル不要
- ライブラリ: @slack/bolt
- Events API を使わない理由: トンネル不要、3秒ルールなし、リトライ処理が SDK に吸収される

## Discord との共通性

Platform インターフェースが共通のため、Router 側のコード変更なしで動作する。
スレッドベースのセッション管理モデルは Discord と同一。

## IncomingMessage への変換

```typescript
{
  platformName: "slack"
  channelId: event.channel
  threadId: event.thread_ts          // スレッド内ならスレッド ts
  userId: event.user
  content: event.text
  repoHint: parseRepoFromTopic(channel.topic)
  raw: event                          // Slack Event オブジェクト
}
```

## 設定

| 環境変数 | 説明 |
|---------|------|
| `SLACK_BOT_TOKEN` | Bot User OAuth Token (`xoxb-`) |
| `SLACK_APP_TOKEN` | App-Level Token (`xapp-`) — Socket Mode に必要 |

## 見積もり

~80行
