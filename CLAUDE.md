# AI Code Agent Hub

## プロジェクト概要

複数の AI コーディングエージェントセッションを WebUI・Discord・Slack・Flutter アプリから操作する統合ハブ。
Discord チャンネルのトピックにリポジトリ名を書くだけで、そのリポジトリ上で AI エージェントが動作する。
QNAP NAS (Container Station) 上の Docker Compose で一発起動。

## 技術スタック

- ランタイム: Node.js 22 / TypeScript
- AI エンジン: Aider (デフォルト) / OpenCode / Claude Code (AGENT 環境変数で切り替え)
- Discord: discord.js
- Slack: @slack/bolt (Socket Mode)
- HTTP: Hono
- コンテナ: Docker Compose
- デプロイ先: QNAP Container Station

## ドキュメント体系

実装の前に必ず対応するドキュメントを読むこと。

| ドキュメント | パス | 用途 |
|------------|------|------|
| 初期構想 | `docs/seeds/` | プロジェクトの原点。変更しない (下記参照) |
| 要求仕様 | `docs/requirements/README.md` | 機能要求・非機能要求の一覧と受け入れ条件 |
| 詳細設計 | `docs/design/` | src/ モジュールと1:1対応する設計ドキュメント |
| 用語集 | `docs/glossary.md` | コード上のシンボルと意味の対応表 |

### seed ドキュメントの関係

| ファイル | 位置づけ |
|---------|---------|
| `docs/seeds/multi-claude-code-webui.md` | 初期構想 (単一リポジトリ版)。参考情報として保持 |
| `docs/seeds/ai-code-agent-hub.md` | **実装の基準**。初期構想をマルチリポジトリ対応に発展させたもの |

実装は `ai-code-agent-hub.md` に基づく。`multi-claude-code-webui.md` は Worktree 設計・デプロイ比較等の参考情報として参照する。

## ドキュメント同期ルール

### コード変更時

- `src/` を変更 → 対応する `docs/design/{同名}.md` の更新要否を判断し、必要なら更新
- `src/` に新規ファイルを追加 → 対応する `docs/design/{同名}.md` を作成し、下記の対応マップにも追記
- 新しい export シンボル (型・クラス・関数) → `docs/glossary.md` に追記
- 要求を満たすコード変更 → `docs/requirements/README.md` のステータスを更新
- `docker-compose.yml` / `Dockerfile` / `.env` を変更 → `docs/design/infrastructure.md` を更新

### ステータス遷移ルール

- **未着手** → **実装中**: 該当要求の実装に着手したとき
- **実装中** → **完了**: 受け入れ条件を満たし、vitest でテストが pass した状態

### 対応マップ

| コード | ドキュメント |
|--------|------------|
| `src/index.ts` | `docs/design/README.md` (エントリポイント/DI 組み立て) |
| `src/router.ts` | `docs/design/router.md` |
| `src/portal.ts` | `docs/design/portal.md` |
| `src/agent-pool.ts` | `docs/design/agent-pool.md` |
| `src/session-pool.ts` | `docs/design/session-pool.md` |
| `src/types.ts` | `docs/glossary.md` |
| `src/platforms/parse-topic.ts` | `docs/design/platforms/discord.md` (リポジトリ解決セクション) |
| `src/platforms/discord.ts` | `docs/design/platforms/discord.md` |
| `src/platforms/slack.ts` | `docs/design/platforms/slack.md` |
| `src/agents/aider.ts` | `docs/design/agents/aider.md` |
| `src/agents/opencode.ts` | `docs/design/agents/opencode.md` |
| `src/agents/claude-code.ts` | `docs/design/agents/claude-code.md` |
| `docker-compose.yml` / `Dockerfile` | `docs/design/infrastructure.md` |
| `tests/**` | `docs/design/testing.md` |
| すべての `src/` 内 export シンボル | `docs/glossary.md` |

### 原則

- docs 更新は実装と同一コミットに含める
- seeds/ は変更しない (履歴として保持)
- 設計判断の変更は design doc に理由を記録する

## ファイル構成

```
src/
├── index.ts              # エントリポイント
├── router.ts             # Platform → Agent 中継
├── portal.ts             # WebUI リバースプロキシ + リポジトリ一覧
├── agent-pool.ts         # Agent プロセス管理
├── session-pool.ts       # セッション管理 (スレッド→セッション ID マッピング)
├── types.ts              # 共通型定義
├── platforms/
│   ├── parse-topic.ts    # parseRepoFromTopic (トピック→リポジトリ名パーサー)
│   ├── discord.ts        # Discord Platform Adapter
│   └── slack.ts          # Slack Platform Adapter
└── agents/
    ├── aider.ts          # Aider Agent Adapter (デフォルト)
    ├── opencode.ts       # OpenCode Agent Adapter (ARM64 非対応)
    └── claude-code.ts    # Claude Code Agent Adapter

tests/
├── unit/                 # 純関数・クラス単体テスト
│   ├── parse-topic.test.ts
│   ├── session-pool.test.ts
│   └── agent-pool-port.test.ts
├── integration/          # Router+AgentPool+MockAgent 結合テスト
│   ├── helpers.ts        # TestPlatform, MockAgent
│   ├── router.test.ts
│   └── agent-pool.test.ts
└── e2e/                  # 実サーバー接続テスト (CI ではスキップ)
    ├── discord.e2e.test.ts
    ├── slack.e2e.test.ts
    └── portal.e2e.test.ts
```

## コーディング規約

- 言語: TypeScript (strict mode)
- パッケージマネージャ: npm
- テスト: vitest (詳細は `docs/design/testing.md`)
- リンター: biome

### テスト実行

- `npm test` — Unit + Integration テスト
- `npm run test:watch` — ウォッチモード
- `npm run test:e2e` — E2E テスト (実サーバー接続、CI ではスキップ)
