# Discord Platform 詳細設計

## 対応要求

- [FR-003](../requirements/README.md) Discord 連携
- [FR-013](../requirements/README.md) チャンネルナビゲーション

## 責務

Discord Gateway (WebSocket) を介してメッセージを送受信する Platform 実装。

## 接続方式

- Discord Gateway (WebSocket) — アウトバウンド接続、トンネル不要
- ライブラリ: discord.js

## リポジトリ解決

チャンネルの **topic** フィールドから `repo:` プレフィックスでリポジトリ名を抽出する。

```
チャンネルトピック: "repo:hummer98/my-blog | branch:main | Next.jsブログ"
→ repoHint = "hummer98/my-blog"
```

topic の利点:
- 自由テキスト (1024文字)
- チャンネルヘッダに常時表示
- API で取得容易 (`channel.topic`)
- 権限で編集者を制限可能

## IncomingMessage への変換

```typescript
{
  platformName: "discord"
  channelId: message.channel.id
  threadId: message.thread?.id      // スレッド内ならスレッド ID
  userId: message.author.id
  content: message.content
  repoHint: parseRepoFromTopic(channel.topic)
  raw: message                       // discord.js の Message オブジェクト
}
```

## インタラクション方式: メッセージベース (@bot メンション)

Slash Commands ではなく `@bot` メンション + スレッド返信を採用する。

| 観点 | Slash Commands | メッセージベース (@bot) |
|------|---------------|----------------------|
| Bot API でのトリガー | 不可 (Interaction はクライアント限定) | 可 (`channel.send()`) |
| E2E テスト自動化 | 極めて困難 | Bot-to-Bot で完全自動化可能 |
| グローバル登録の伝播 | 最大1時間 | 即座に反応 |

テスト容易性を優先する設計判断。主要ユースケースは「スレッド内で会話を続ける」であり、
初回の `@bot` メンションでスレッドが始まれば十分。

## スレッド管理

- `@bot` へのリプライ → 自動的にスレッドを作成
- `startThread()`: `message.startThread({ name })` で Discord スレッドを作成
- `reply()`: スレッド内にメッセージを送信 (空文字列の場合は送信をスキップ)

## チャンネルナビゲーション (FR-013)

新規チャンネル作成時にセットアップ案内メッセージを自動投稿する。

- `channelCreate` イベントを監視
- `DISCORD_CATEGORY_ID` が設定されている場合、そのカテゴリ内のチャンネルのみ対象
- トピックに `repo:` が未設定のチャンネルに対して案内を送信

## 設定

| 環境変数 | 説明 |
|---------|------|
| `DISCORD_TOKEN` | Bot トークン |
| `DISCORD_CATEGORY_ID` | 監視対象のカテゴリ ID |

## Discord Bot 管理情報

| 項目 | 値 |
|------|-----|
| Bot 名 | hub |
| Bot ID (Client ID) | `1439672503810261083` |
| 管理アカウント | `rr.yamamoto+discord@gmail.com` |
| Developer Portal | 上記アカウントでログインして管理 |
| テスト用サーバー ID | `1240905723555086336` |
| テスト用 #一般 チャンネル ID | `1240905723555086339` |
| Message Content Intent | 有効 |

## 見積もり

~80行
