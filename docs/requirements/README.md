# 要求仕様書

## 機能要求 (FR)

| ID | 要求 | 優先度 | ステータス | 受け入れ条件 | 対応設計書 |
|----|------|--------|-----------|------------|-----------|
| FR-001 | マルチリポジトリ | 高 | 実装中 | チャンネル毎に異なるリポジトリで Agent が動作する | [router](../design/router.md), [agent-pool](../design/agent-pool.md) |
| FR-002 | マルチセッション | 高 | 実装中 | スレッド毎に独立したエージェントセッションが維持される | [session-pool](../design/session-pool.md) |
| FR-003 | Discord 連携 | 高 | 実装中 | Discord チャンネルトピックの `repo:` からリポジトリを解決し、スレッドでセッションを管理できる | [discord](../design/platforms/discord.md) |
| FR-004 | Slack 連携 | 中 | 実装中 | Socket Mode で接続し、Discord と同じセッションモデルで動作する | [slack](../design/platforms/slack.md) |
| FR-005 | WebUI (Portal) | 高 | 実装中 | リポジトリ一覧を表示し、各リポジトリの opencode web にリバースプロキシする | [portal](../design/portal.md) |
| FR-006 | マルチエージェント | 中 | 実装中 | Agent インターフェースにより OpenCode / Claude Code を差し替え可能 | [opencode](../design/agents/opencode.md), [claude-code](../design/agents/claude-code.md) |
| FR-007 | Agent プロセス管理 | 高 | 実装中 | リポジトリ毎に Agent プロセスを起動/停止し、ポートを動的に割り当てる | [agent-pool](../design/agent-pool.md) |
| FR-008 | セッションライフサイクル | 高 | 実装中 | 作成→利用→休止(アイドルタイムアウト)→復帰→終了 のライフサイクルを管理する | [session-pool](../design/session-pool.md) |
| FR-009 | Flutter App | 低 | 未着手 | Portal REST API + opencode REST/SSE API でモバイルから操作できる | (未作成) |
| FR-010 | Docker 一発起動 | 高 | 実装中 | `docker compose up -d` で全サービスが起動する (→ NFR-001, NFR-005) | [infrastructure](../design/infrastructure.md) |
| FR-011 | リポジトリ自動 clone | 高 | 完了 | 初回アクセス時に GitHub から自動 clone する。GITHUB_TOKEN でプライベートリポジトリにも対応する | [agent-pool](../design/agent-pool.md) |
| FR-012 | ストリーミング応答 | 高 | 実装中 | Agent の応答を SSE でストリーミング受信し、Discord/Slack に逐次返信する | [router](../design/router.md), [opencode](../design/agents/opencode.md) |
| FR-013 | チャンネルナビゲーション | 中 | 実装中 | 新規チャンネル作成時にセットアップ案内メッセージを自動投稿する | [discord](../design/platforms/discord.md) |

## 非機能要求 (NFR)

| ID | 要求 | 優先度 | ステータス | 受け入れ条件 | 対応設計書 |
|----|------|--------|-----------|------------|-----------|
| NFR-001 | Docker 隔離 | 高 | 実装中 | ホストマシンのプロセスに干渉しない (→ FR-010) | [infrastructure](../design/infrastructure.md) |
| NFR-002 | メモリ制限 | 中 | 実装中 | 3-5 リポジトリ同時稼働で 4GB 以内 | [infrastructure](../design/infrastructure.md) |
| NFR-003 | アイドルタイムアウト | 中 | 実装中 | 30分無操作で Agent プロセスを自動停止、再アクセスで再起動 | [agent-pool](../design/agent-pool.md) |
| NFR-004 | モデル非依存 | 中 | 未着手 | Anthropic, OpenAI, Google, Ollama 等 75+ プロバイダ対応 | [opencode](../design/agents/opencode.md) |
| NFR-005 | QNAP 互換 | 高 | 実装中 | QNAP Container Station (Docker Compose) で動作する (→ FR-010) | [infrastructure](../design/infrastructure.md) |
| NFR-006 | セッション永続化 | 中 | 実装中 | コンテナ再起動後もセッション履歴が保持される (Volume mount) | [infrastructure](../design/infrastructure.md) |
| NFR-007 | Portal 認証 | 中 | 実装中 | HTTP Basic Auth で未認証アクセスを拒否する (PORTAL_PASSWORD) | [portal](../design/portal.md) |
| NFR-008 | Worktree セッション分離 | 中 | 未着手 | 複数セッションが同一リポジトリで同時作業してもファイルコンフリクトしない (git worktree) | [opencode](../design/agents/opencode.md) |

## ステータス定義

- **未着手**: 実装に着手していない
- **実装中**: 開発中
- **完了**: 受け入れ条件を満たし、テスト済み
