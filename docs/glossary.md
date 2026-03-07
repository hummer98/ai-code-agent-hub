# 用語集 (シンボル-セマンティックマップ)

## インターフェース

| シンボル | 定義場所 | 意味 |
|---------|---------|------|
| `Platform` | `src/types.ts` | UI 層の抽象。Discord や Slack など外部チャットプラットフォームとの接続を担う。メッセージ受信・返信・スレッド作成の責務を持つ |
| `Agent` | `src/types.ts` | AI エンジン層の抽象。OpenCode や Claude Code など AI コーディングエージェントのプロセス管理を担う |
| `AgentProcess` | `src/types.ts` | 1 リポジトリに対して起動された Agent プロセスのラッパー。セッションの作成・プロンプト送信を提供する。`resumeSession()` は no-op (opencode がセッションを永続化するため不要) |
| `IncomingMessage` | `src/types.ts` | Platform から Router に渡される正規化されたメッセージ。プラットフォーム固有の情報を共通形式に変換したもの |

## クラス

| シンボル | 定義場所 | 意味 |
|---------|---------|------|
| `Router` | `src/router.ts` | Platform からのメッセージを受け取り、Agent Pool / Session Pool を介して Agent にルーティングする中継層。Platform と Agent の具象を知らない |
| `Portal` | `src/portal.ts` | WebUI 用の HTTP サーバ。リポジトリ一覧 API と、各リポジトリの opencode web へのリバースプロキシを提供する |
| `AgentPool` | `src/agent-pool.ts` | リポジトリ名から Agent プロセスを取得 (なければ起動) するプール。初回アクセス時にリポジトリを自動 clone し、アイドルタイムアウトによるプロセス回収も担う |
| `SessionPool` | `src/session-pool.ts` | スレッド ID → セッション ID のマッピングを管理。セッションの作成・復帰を担う (タイムアウトによるプロセス回収は AgentPool の責務) |
| `DiscordPlatform` | `src/platforms/discord.ts` | Discord Gateway (WebSocket) を介してメッセージを送受信する Platform 実装 |
| `SlackPlatform` | `src/platforms/slack.ts` | Slack Socket Mode (WebSocket) を介してメッセージを送受信する Platform 実装 |
| `OpenCodeAgent` | `src/agents/opencode.ts` | `@opencode-ai/sdk` の `createOpencodeServer()` でプロセスを起動する Agent 実装 |
| `ClaudeCodeAgent` | `src/agents/claude-code.ts` | Claude Code CLI (`claude`) をサブプロセスとして起動する Agent 実装。repoPath 単位で `ClaudeCodeAgentProcess` を管理する |
| `ClaudeCodeAgentProcess` | `src/agents/claude-code.ts` | Claude Code CLI の AgentProcess 実装。`prompt()` 毎に `claude -p --session-id --output-format stream-json` を spawn し、stdout の JSON Lines からテキストを yield する |

## テストダブル

| シンボル | 定義場所 | 意味 |
|---------|---------|------|
| `TestPlatform` | `tests/integration/helpers.ts` | Platform インターフェースのテスト実装。メッセージ注入 (`simulateMessage`) と返信の記録 (`replies`) を提供する |
| `MockAgent` | `tests/integration/helpers.ts` | Agent インターフェースのテスト実装。実際の opencode プロセスなしで全フローをテスト可能にする |
| `MockAgentProcess` | `tests/integration/helpers.ts` | AgentProcess のテスト実装。`prompt()` はエコー応答を返す `AsyncIterable<string>` |

## ドメイン用語

| 用語 | 意味 |
|------|------|
| チャンネルトピック | Discord チャンネルの topic フィールド。`repo:owner/name` 形式でリポジトリを指定する |
| repoHint | IncomingMessage に含まれる、チャンネルトピック等から解決済みのリポジトリ名 (`owner/repo` 形式) |
| セッション | 1 スレッド = 1 セッション。Agent との会話の単位。セッション ID で識別する |
| アイドルタイムアウト | 一定時間 (デフォルト 30 分) 無操作の Agent プロセスを自動停止する仕組み |
| Portal | ブラウザ向けの入口。リポジトリ一覧 + opencode web へのリバースプロキシ (~50行) |
| Agent Pool | 複数リポジトリの Agent プロセスを管理する共有層。Router と Portal の両方から参照される |
| Platform Adapter | 外部チャットプロトコルを IncomingMessage に変換するアダプター。WebUI は opencode web が直接担うため Adapter 不要 |
| cloneInFlight | 同一リポジトリへの並行 clone リクエストをデデュプリケーションするための `Map<repoName, Promise<void>>`。clone 完了/失敗後にエントリが削除される |

## ユーティリティ関数

| シンボル | 定義場所 | 意味 |
|---------|---------|------|
| `parseRepoFromTopic` | `src/platforms/parse-topic.ts` | チャンネルトピック文字列から `repo:owner/name` を抽出し、`owner/name` を返すパーサー。Discord/Slack の両 Platform から共有利用 |
| `AgentPool.ensureCloned` | `src/agent-pool.ts` | repoPath が存在しなければ GitHub から `git clone` を実行する。同一リポジトリへの重複 clone を Promise キャッシュで防止する |
| `AgentPool.buildCloneUrl` | `src/agent-pool.ts` | (static) repoName と任意の GITHUB_TOKEN から clone URL を生成する。トークンありなら `https://{token}@github.com/{repo}.git` |
| `AgentPool.pathExists` | `src/agent-pool.ts` | (static) 指定パスの存在チェック。`fs.access` のラッパー。テストでモック可能にするために static メソッドとして公開 |

## 環境変数

| シンボル | 意味 |
|---------|------|
| `DISCORD_TOKEN` | Discord Bot トークン |
| `DISCORD_CATEGORY_ID` | 監視対象の Discord カテゴリ ID |
| `SLACK_BOT_TOKEN` | Slack Bot User OAuth Token (`xoxb-`) |
| `SLACK_APP_TOKEN` | Slack App-Level Token (`xapp-`) — Socket Mode に必要 |
| `PORTAL_PASSWORD` | Portal の HTTP Basic Auth パスワード |
| `GITHUB_TOKEN` | GitHub Personal Access Token (プライベートリポジトリ clone 用) |
| `GITHUB_OWNER` | デフォルトのリポジトリオーナー |
| `HUB_REPOS_PATH` | repos Volume のホスト側パス |
| `HUB_DATA_PATH` | data Volume のホスト側パス |
| `HUB_CONFIG_PATH` | config Volume のホスト側パス |
| `E2E_TEST_BOT_TOKEN` | E2E テスト用 Discord Bot トークン |
| `E2E_TARGET_BOT_ID` | E2E テスト対象 Bot のユーザ ID |
| `E2E_DISCORD_CHANNEL_ID` | E2E テスト用 Discord チャンネル ID |
| `E2E_DISCORD_GUILD_ID` | E2E テスト用 Discord サーバー ID |
