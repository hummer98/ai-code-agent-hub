# 詳細設計書

## レイヤー構成

```
┌─────────────────────────────────────────────────┐
│  Platform 層 (UI)                                │
│  Discord / Slack                                 │
└──────────────────────┬──────────────────────────┘
                       │ IncomingMessage
┌──────────────────────▼──────────────────────────┐
│  Router                                          │
│  Platform → Agent 中継 (どちらの具象も知らない)    │
└──────────────────────┬──────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────┐
│  Agent Pool + Session Pool (共有層)               │
│  プロセス管理 / セッション管理                      │
└──────────────────────┬──────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────┐
│  Agent 層 (AI エンジン)                           │
│  Aider / OpenCode / Claude Code                  │
└─────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────┐
│  Portal (独立)                                    │
│  WebUI リバースプロキシ + リポジトリ一覧            │
│  Agent Pool を参照するが Router を経由しない        │
└─────────────────────────────────────────────────┘
```

## モジュール一覧

| モジュール | 設計ドキュメント | 責務 |
|-----------|----------------|------|
| Router | [router.md](router.md) | Platform からのメッセージを Agent Pool/Session Pool 経由で Agent に中継 |
| Portal | [portal.md](portal.md) | リポジトリ一覧 + opencode web へのリバースプロキシ |
| Agent Pool | [agent-pool.md](agent-pool.md) | Agent プロセスの起動/停止/ポート割当/アイドル回収 |
| Session Pool | [session-pool.md](session-pool.md) | スレッド/タブ → セッション ID マッピング |
| Discord Platform | [platforms/discord.md](platforms/discord.md) | Discord Gateway → IncomingMessage 変換 |
| Slack Platform | [platforms/slack.md](platforms/slack.md) | Slack Socket Mode → IncomingMessage 変換 |
| Aider Agent | [agents/aider.md](agents/aider.md) | Aider CLI プロセスの管理 (デフォルト) |
| OpenCode Agent | [agents/opencode.md](agents/opencode.md) | OpenCode CLI プロセスの管理 (ARM64 非対応) |
| Claude Code Agent | [agents/claude-code.md](agents/claude-code.md) | Claude Code CLI プロセスの管理 |
| Infrastructure | [infrastructure.md](infrastructure.md) | Docker Compose / Dockerfile / Volume / 環境変数 / メモリ要件 |
| Testing | [testing.md](testing.md) | テストピラミッド / テストダブル (TestPlatform, MockAgent) / CI 戦略 |

## 設計原則

- **Interface 分離**: Platform (UI層) と Agent (AI層) を Interface で分離。Router はどちらの具象も知らない
- **プロセス分離**: 各リポジトリは独立した Agent プロセスで動作
- **Docker-first**: 全コンポーネントを単一コンテナ内に封じ込め
- **WebUI は Platform Adapter にしない**: opencode web が「ブラウザ → Agent API」の変換を既に担っているため、Adapter を挟む意味がない。Portal (リバースプロキシ) で十分
- **タイムアウト管理は Agent Pool に集約**: Session Pool はマッピングのみ管理し、タイマーによるプロセス回収は Agent Pool が担う。プロセス停止後もセッション ID は保持され、再アクセス時に resumeSession() で復帰する
