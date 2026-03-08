import { describe, test } from "vitest"

// TODO: Slack E2E テストを実装
// - テスト用 Slack Bot (SLACK_TEST_BOT_TOKEN) で chat.postMessage を送信
// - Hub bot がスレッドに応答したことを conversations.replies で確認
// - chat.delete でクリーンアップ
// 環境変数: SLACK_TEST_BOT_TOKEN, SLACK_TEST_CHANNEL_ID

describe.skip("Slack E2E", () => {
  test.todo("@hub mention creates a thread and bot replies")
  test.todo("message in existing thread continues conversation")
})
