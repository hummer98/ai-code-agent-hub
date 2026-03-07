# マルチ AI コーディングエージェント WebUI アーキテクチャ構想

## 概要

複数の AI コーディングエージェントセッションを WebUI・Discord・Slack・Flutter アプリから操作するためのアーキテクチャ。
**OpenCode** をコアエンジンとして採用し、組み込み WebUI + REST API + SSE ストリーミングを活用する。
自前実装は Discord/Slack の Adapter と Flutter アプリのみに絞る。

## 要件

| 要件 | 内容 |
|------|------|
| マルチセッション | 複数のエージェントセッションを同時に使いたい |
| 低レイテンシ | 毎回のインストール・checkout 不要 |
| 単一リポジトリ | 1つのリポジトリに対して動作 |
| マルチクライアント | WebUI, Discord, Slack, Flutter App |
| 実行環境 | Docker コンテナ (ホストマシンのプロセスに干渉しない) |
| モデル非依存 | Anthropic, OpenAI, Google, Ollama 等 75+ プロバイダ対応 |

## コアエンジン: OpenCode

| 項目 | 内容 |
|------|------|
| リポジトリ | [github.com/anomalyco/opencode](https://github.com/anomalyco/opencode) |
| GitHub Stars | 117,000+ |
| ライセンス | MIT |
| 言語 | TypeScript |
| 開発元 | Anomaly (旧 SST / Serverless Stack、YC 2021) |

### OpenCode を採用する理由

| 機能 | 内容 |
|------|------|
| `opencode web` | WebUI + API Server が 1 コマンドで起動 |
| `opencode serve` | ヘッドレス API サーバ (REST + SSE + OpenAPI 3.1) |
| `@opencode-ai/sdk` | TypeScript SDK でプログラマティック制御 |
| `opencode run` | 非インタラクティブモード (`--format json`) |
| `opencode acp` | JSON-RPC over stdin/stdout (エディタ統合) |
| プラグインシステム | Worktree 管理等のエコシステム |
| MCP 対応 | Model Context Protocol (ローカル + リモート、OAuth) |

## アーキテクチャ

### 設計方針: Docker で完全隔離

ホストマシンのプロセスに干渉しないよう、全コンポーネントを Docker コンテナ内に封じ込める。
`docker compose up` 一発で全サービスが起動する構成。

### 全体構成

```
┌─────────────────────────── Docker Compose ──────────────────────────┐
│                                                                     │
│  ┌────────────────────────────────────────────────────────────────┐  │
│  │  opencode (コンテナ)                                          │  │
│  │  opencode web --port 4096 --hostname 0.0.0.0                  │  │
│  │  ├─ Built-in WebUI (SolidJS)                                  │  │
│  │  ├─ REST API (50+ endpoints)                                  │  │
│  │  ├─ SSE Streaming                                             │  │
│  │  └─ OpenAPI 3.1 Spec (/doc)                                   │  │
│  │                                                                │  │
│  │  Volumes:                                                      │  │
│  │  ├─ repo:/repo (対象リポジトリ)                                │  │
│  │  ├─ opencode-data:/root/.local/share/opencode (セッション永続) │  │
│  │  └─ opencode-config:/root/.config/opencode (設定永続)          │  │
│  └──────────────────────────┬─────────────────────────────────────┘  │
│                             │ :4096                                  │
│  ┌──────────────────────────▼─────────────────────────────────────┐  │
│  │  discord-bot (コンテナ)  │  slack-bot (コンテナ)               │  │
│  │  Gateway WS (outbound)  │  Socket Mode (outbound)             │  │
│  │  → opencode:4096        │  → opencode:4096                    │  │
│  └────────────────────────────────────────────────────────────────┘  │
│                                                                     │
└──────────────────────────┬──────────────────────────────────────────┘
                           │ :4096 (host port mapping)
                    ┌──────▼──────┐
                    │ Flutter App │ (ホスト外部から REST+SSE)
                    └─────────────┘
```

### なぜ Docker か

| 懸念 | Docker での解決 |
|------|----------------|
| ホストのプロセスに干渉したくない | コンテナ内で完全隔離 |
| Node.js / opencode のバージョン管理 | イメージに固定、ホスト汚染なし |
| 環境再現性 | `docker compose up` で誰でも同一環境 |
| クリーンアップ | `docker compose down -v` で完全削除 |
| チーム共有・クラウドデプロイ | イメージをそのまま push 可能 |

### `opencode serve` vs `opencode web`

| | `opencode serve` | `opencode web` |
|---|---|---|
| HTTP API | あり | あり (同じバックエンド) |
| フロントエンド | なし (API のみ) | **あり** (SolidJS ブラウザ UI) |
| OpenAPI `/doc` | あり | あり |
| セッション管理 UI | なし | **あり** (サイドバー + セッション一覧) |
| 用途 | SDK・IDE 連携・カスタムクライアント向け | そのままブラウザで使える |

コンテナ内では `opencode web` を使用し、WebUI + API を同時に提供する。

### WebUI の機能

- マルチセッション対応 (一覧・作成・アーカイブ・フォーク)
- チャット UI (ファイル添付、スラッシュコマンド、@メンション)
- ツール実行の可視化 (read, edit, write の折りたたみカード)
- Diff ビュー (split/unified 切り替え)
- モデル/プロバイダ選択
- ダークモード対応
- HTTP Basic Auth 対応 (`OPENCODE_SERVER_PASSWORD`)

## クライアント Adapter 設計

### 設計原則

各クライアントは `@opencode-ai/sdk` 経由で `opencode serve` / `opencode web` に接続する薄い Adapter に過ぎない。

```
ユーザ → Bot/App (Adapter) → opencode REST API + SSE → AI エージェント
                                      ↓
ユーザ ← Bot/App (Adapter) ← SSE streaming events
```

### SDK 接続例

```typescript
import { createOpencodeClient } from "@opencode-ai/sdk"

const client = createOpencodeClient({
  baseUrl: "http://localhost:4096"
})

const session = await client.session.create()
await client.session.prompt(session.id, { content: "Fix the bug" })
```

### Discord Adapter

```typescript
// Discord: Gateway (WebSocket) — アウトバウンド接続、トンネル不要
import { createOpencodeClient } from "@opencode-ai/sdk"

const oc = createOpencodeClient({ baseUrl: "http://localhost:4096" })

discord.on("messageCreate", async (msg) => {
  const session = await oc.session.create()
  await oc.session.prompt(session.id, { content: msg.content })
  // SSE でストリーミング受信 → Discord に転送
});
```

### Slack Adapter

```typescript
// Slack: Socket Mode (WebSocket) — アウトバウンド接続、トンネル不要
import { createOpencodeClient } from "@opencode-ai/sdk"

const oc = createOpencodeClient({ baseUrl: "http://localhost:4096" })
const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  appToken: process.env.SLACK_APP_TOKEN,
  socketMode: true,
});

app.message(async ({ message, say }) => {
  const session = await oc.session.create()
  await oc.session.prompt(session.id, { content: message.text })
  // SSE でストリーミング受信 → Slack thread reply で逐次投稿
});
```

### Flutter App

- `@opencode-ai/sdk` の REST API をそのまま叩く (HTTP + SSE)
- Dart の `http` / `dio` + `eventsource` パッケージで SSE 受信
- API Server 側の追加実装は不要

## Docker Compose 構成

### docker-compose.yml (QNAP Container Station 向け)

```yaml
services:
  opencode:
    build: ./docker/opencode
    ports:
      - "4096:4096"
    volumes:
      # .env でパスを切り替え可能 (QNAP / Linux VM / ローカル)
      - ${OPENCODE_REPO_PATH:-./.opencode/repo}:/repo
      - ${OPENCODE_DATA_PATH:-./.opencode/data}:/root/.local/share/opencode
      - ${OPENCODE_CONFIG_PATH:-./.opencode/config}:/root/.config/opencode
    environment:
      - OPENCODE_SERVER_PASSWORD=${OPENCODE_SERVER_PASSWORD}
      # LLM プロバイダ (必要なものだけ)
      - ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}
      - OPENAI_API_KEY=${OPENAI_API_KEY}
      - GOOGLE_API_KEY=${GOOGLE_API_KEY}
      # または OpenCode Zen / OpenRouter 1本で全モデル対応
      - OPENCODE_ZEN_API_KEY=${OPENCODE_ZEN_API_KEY}
    working_dir: /repo
    restart: unless-stopped
    deploy:
      resources:
        limits:
          memory: 4G      # 3-5 セッション同時想定
        reservations:
          memory: 1G

  discord-bot:
    build: ./docker/discord-bot
    depends_on:
      - opencode
    environment:
      - DISCORD_TOKEN=${DISCORD_TOKEN}
      - OPENCODE_URL=http://opencode:4096
    restart: unless-stopped
    deploy:
      resources:
        limits:
          memory: 256M
    profiles: ["discord"]  # docker compose --profile discord up

  slack-bot:
    build: ./docker/slack-bot
    depends_on:
      - opencode
    environment:
      - SLACK_BOT_TOKEN=${SLACK_BOT_TOKEN}
      - SLACK_APP_TOKEN=${SLACK_APP_TOKEN}
      - OPENCODE_URL=http://opencode:4096
    restart: unless-stopped
    deploy:
      resources:
        limits:
          memory: 256M
    profiles: ["slack"]    # docker compose --profile slack up
```

### Dockerfile (opencode)

```dockerfile
FROM node:22-slim

RUN apt-get update && apt-get install -y git && rm -rf /var/lib/apt/lists/*
RUN npm install -g opencode

# Worktree プラグイン
RUN npx ocx add kdco/worktree --from https://registry.kdco.dev

EXPOSE 4096
CMD ["opencode", "web", "--port", "4096", "--hostname", "0.0.0.0"]
```

### 起動方法

```bash
# 基本 (WebUI + API のみ)
docker compose up -d

# Discord bot も起動
docker compose --profile discord up -d

# Slack bot も起動
docker compose --profile slack up -d

# 全部起動
docker compose --profile discord --profile slack up -d

# 停止・クリーンアップ
docker compose down       # コンテナ停止 (データ保持)
docker compose down -v    # コンテナ + データ完全削除
```

### Volume 設計 (QNAP NAS bind mount)

Docker named volume ではなく、NAS フォルダの bind mount を採用する。

| マウント元 (NAS) | マウント先 (コンテナ) | 内容 |
|-----------------|---------------------|------|
| `/share/Container/opencode/repo` | `/repo` | 対象リポジトリ |
| `/share/Container/opencode/data` | `/root/.local/share/opencode` | セッション履歴・worktree 状態 |
| `/share/Container/opencode/config` | `/root/.config/opencode` | 設定・プラグイン |

#### 環境別 .env 設定例

```env
# .env.qnap (QNAP NAS)
OPENCODE_REPO_PATH=/share/Container/opencode/repo
OPENCODE_DATA_PATH=/share/Container/opencode/data
OPENCODE_CONFIG_PATH=/share/Container/opencode/config

# .env.local (ローカル Mac/Linux)
OPENCODE_REPO_PATH=./repo
OPENCODE_DATA_PATH=./.opencode/data
OPENCODE_CONFIG_PATH=./.opencode/config

# .env.vm (クラウド VM)
OPENCODE_REPO_PATH=/opt/opencode/repo
OPENCODE_DATA_PATH=/opt/opencode/data
OPENCODE_CONFIG_PATH=/opt/opencode/config
```

```bash
# 環境を切り替えて起動
cp .env.qnap .env && docker compose up -d
```

docker-compose.yml にはデフォルト値 (`./.opencode/*`) を設定しているため、`.env` なしでもそのまま動作する。

#### なぜ Docker volume ではなく NAS bind mount か

コンテナは QNAP 上で動いているため、Docker volume も bind mount も**同じ物理ディスクを通る**。
I/O オーバーヘッドの差はゼロ。bind mount のほうが運用上のメリットが大きい。

| 観点 | Docker volume | NAS bind mount |
|------|--------------|----------------|
| File Station から閲覧 | 面倒 | **直接見える** |
| NAS バックアップ連携 | 手動設定 | **そのまま対象に入る** |
| スナップショット | 対象外の場合あり | **RAID + スナップショット保護** |
| 別コンテナから参照 | volume 指定が必要 | **パスで直接アクセス** |
| データの可搬性 | docker volume export | **ファイルコピーで済む** |

#### ストレージ性能の考慮

| ストレージ | 影響 |
|-----------|------|
| SSD プール | 問題なし |
| HDD (RAID5/6) | grep/glob で大量ファイルを走査する時にやや遅い可能性あり。ただし会話履歴の読み書き程度なら問題なし |

### メモリ要件

LLM 推論はリモート API で実行されるため、GPU やモデル用メモリは不要。
メモリを消費するのは主に Node.js ヒープ (会話履歴、ストリーミングバッファ)。

| 同時セッション | 最低限 | 推奨 |
|--------------|--------|------|
| 1-2 セッション | 1GB | 2GB |
| 3-5 セッション | 2GB | **4GB** |
| 5-10 セッション | 4GB | 8GB |

## Bot 接続方式の設計判断

### Discord / Slack ともにトンネル不要

両 bot ともアウトバウンド WebSocket 接続を使用するため、ポート開放やトンネル (ngrok 等) は不要。

```
Bot ──WebSocket──→ Discord/Slack サーバ (アウトバウンド)
```

| Bot | 接続方式 | 方向 | トンネル |
|-----|---------|------|---------|
| Discord | Gateway (WebSocket) | Bot → Discord | 不要 |
| Slack | Socket Mode (WebSocket) | Bot → Slack | 不要 |

### なぜ Slack Events API (HTTP) を使わないか

Slack には Events API (HTTP webhook) と Socket Mode (WebSocket) の2つの接続方式がある。
本構想では **Socket Mode を採用**する。

| | Events API (HTTP) | Socket Mode (WS) |
|---|---|---|
| トンネル | 必要 (ngrok 等) | **不要** |
| 3秒ルール | あり (3秒以内に HTTP 200 を返さないとリトライ) | **なし** |
| リトライ処理 | 自前で実装 (`x-slack-retry-num` ハンドリング) | **SDK が吸収** |
| URL Verification | 初期設定時に challenge 応答が必要 | **不要** |
| Marketplace 公開 | 可能 | **不可** |
| Slack 公式推奨 | 本番・配布向け | ローカル・社内向け |
| セットアップ | やや面倒 | **簡単** |

Events API の制約:
- **3秒ルール**: HTTP 200 を 3秒以内に返さないと Slack が最大3回リトライ。AI の応答は数十秒かかるため、即座に ack → 非同期処理が必須
- **公開エンドポイント**: ローカルではトンネルが必須
- **リトライ制御**: 重複処理防止のため `x-slack-retry-num` ヘッダのハンドリングが必要

Events API が必要になるのは Slack App Directory に公開するケースのみ。
個人・社内利用では Socket Mode 一択。

## Git Worktree によるセッション分離

### なぜ worktree か

複数セッションが同一ディレクトリで同時にファイルを編集するとコンフリクトが発生する。
git worktree で各セッションに独立した作業ディレクトリを提供する。

- `git clone` は重い (ネットワーク + ディスク I/O)
- worktree は同一 `.git` を共有するので、作成が **数十ms〜数百ms**
- 各セッションが独立したワーキングディレクトリを持てる
- ブランチも独立して切り替え可能

### OpenCode の Worktree 対応

OpenCode 本体に `/experimental/worktree` API エンドポイントがあり、基本的な create / reset / remove は組み込みで対応。
加えて、プラグインエコシステムで拡張可能。

### Worktree プラグイン比較

| | **opencode-worktree** (kdcokenny) | **opencode-worktree-session** (felixAnhalt) | **open-trees** (0xSero) |
|---|---|---|---|
| Stars | 253 | 20 | 59 |
| ライセンス | MIT | Apache 2.0 | MIT |
| インストール | ocx registry | npm | npm / bunx CLI |
| **ターミナル自動起動** | 17+ 対応 (tmux 含む) | 5 種 | なし (セッション UI 経由) |
| **削除時 auto-commit** | あり | あり | なし |
| **削除時 auto-push** | なし | **あり** | なし |
| **セッション fork** | あり (plan + delegation 引継) | なし | あり |
| **Swarm (一括作成)** | なし | なし | **あり** |
| **ファイル同期** | copyFiles + symlinkDirs | なし | なし |
| **ライフサイクル hook** | postCreate + preDelete | postCreate のみ | なし |
| **ダッシュボード** | なし | なし | **あり** |
| **Dirty worktree 保護** | なし (強制削除) | なし (強制削除) | **あり** |
| **State 管理** | SQLite | JSON | JSON |
| Worktree 格納先 | `~/.local/share/opencode/worktree/` | `.opencode/worktrees/` | `.worktrees/` |

### 推奨: opencode-worktree (kdcokenny)

| 評価軸 | 判断 |
|--------|------|
| 成熟度 | 最多 Stars (253)、SQLite でクラッシュ安全 |
| セッション分離 | worktree 作成 + セッション fork で文脈引継ぎ |
| ファイル同期 | `.env` コピーや `node_modules` symlink に対応 |
| 安全性 | ブランチ名バリデーション、パストラバーサル防止 |
| auto-push しない | 意図しないリモート変更を防げる |

設定例 (`.opencode/worktree.jsonc`):
```jsonc
{
  "sync": {
    "copyFiles": [".env", ".env.local"],
    "symlinkDirs": ["node_modules"],
    "exclude": []
  },
  "hooks": {
    "postCreate": ["pnpm install"],
    "preDelete": ["docker compose down"]
  }
}
```

### Worktree ワークフロー

```
1. opencode web 起動
2. ユーザがセッション作成
3. AI (またはユーザ) が worktree_create("feature/xxx") を呼ぶ
4. プラグインが git worktree add → セッション fork
5. 各セッションが独立ディレクトリで作業 (コンフリクトなし)
6. 完了後 worktree_delete → auto-commit → worktree 削除
```

## 運用上の考慮事項

### 認証
- 各 LLM プロバイダの API キーを環境変数で注入
- OpenCode サーバの保護: `OPENCODE_SERVER_PASSWORD` で HTTP Basic Auth

### 同時セッション数
- 各プロバイダの API レートリミットに依存
- 実用的には 3〜5 セッション同時が妥当
- セッション毎にトークン消費が発生するため、コスト管理も必要

### セッション永続化
- OpenCode のセッションは内部で永続化される
- サーバ再起動後もセッション一覧から復帰可能

### クライアント追加
- OpenAPI 3.1 仕様に従えば何でも接続可能 (LINE, Teams 等)
- SDK は TypeScript だが、REST API は言語非依存

## デプロイ構成の比較

| 構成 | レイテンシ | コスト | 運用負荷 | おすすめ度 |
|------|-----------|--------|---------|-----------|
| **ローカル Docker Compose** | ◎ 最速 | ◎ 無料 | ◎ 最低 | ★★★ 個人利用 |
| **単一 VM + Docker** | ○ 良好 | ○ 中程度 | ○ 低い | ★★★ チーム利用 |
| **Cloud Run** | △ コールドスタート | ◎ 従量課金 | ◎ 最低 | ★☆☆ 不向き |
| **ECS/GKE** | ○ 良好 | △ 高い | △ 高い | ★★☆ 大規模のみ |

Cloud Run はリクエストベースのスケーリングモデルで、長時間のインタラクティブセッションやステートフルなプロセスプールと相性が悪い。

ローカル Docker Compose がそのまま VM にデプロイ可能なため、個人利用からチーム利用まで同一構成でスケールできる。

## AI コーディングモデル選定 (2026年3月時点)

OpenCode はモデル非依存 (75+ プロバイダ対応) のため、用途に応じたモデル使い分けが可能。

### SWE-bench Verified ランキング

| Rank | モデル | スコア | 価格 (入力/出力 per 1M) | 備考 |
|------|--------|--------|----------------------|------|
| 1 | Claude Opus 4.6 | **80.8%** | $5.00 / $25.00 | Arena Coding Elo 1位 |
| 2 | Gemini 3.1 Pro | **80.6%** | $2.00 / $12.00 | 2026/02 リリース |
| 3 | MiniMax M2.5 | **80.2%** | **$0.30 / $1.20** | オープンウェイト最強 |
| 4 | GPT-5.3 Codex | ~80.0% | $1.75 / $14.00 | Terminal-Bench/SWE-Pro 1位 |
| 5 | Claude Sonnet 4.6 | 79.6% | $3.00 / $15.00 | Opus の 98% 品質 |
| 6 | GLM-5 | **77.8%** | **$1.00 / $3.20** | MIT、2026/02 リリース |
| 7 | Kimi K2.5 | **76.8%** | **$0.60 / $3.00** | オープンソース |
| 8 | GLM-4.7 | 73.8% | $0.60 / $2.20 | Flash 版は無料 |
| 9 | DeepSeek V3.2 (Thinking) | 73.1% | $0.55 / $2.19 | |
| 10 | Devstral 2 | 72.2% | オープンウェイト | Mistral、256K ctx |
| — | DeepSeek V4 | *83.7%* (リーク) | 未発表 | 2026/03 初旬リリース予定 |

※ SWE-bench Verified は上位が 80% 前後に飽和。OpenAI は学習データ汚染を指摘しており、SWE-bench Pro が新基準に移行中。

### LM Arena Coding Elo (2026/03/04, 184,734 票)

| Rank | モデル | Elo |
|------|--------|-----|
| 1 | Claude Opus 4.6 (thinking) | **1556** |
| 2 | Claude Opus 4.6 | **1555** |
| 3 | Claude Sonnet 4.6 | **1523** |
| 6 | GPT-5.2 (high) | 1472 |
| 7 | Gemini 3.1 Pro | 1461 |
| 8 | GLM-5 | 1447 |
| 9 | Gemini 3 Pro | 1442 |
| 11 | GLM-4.7 | 1441 |
| 12 | Kimi K2.5 (thinking) | 1438 |
| 18 | Qwen 3.5 (397B) | 1396 |

### LiveCodeBench (競技プログラミング)

| モデル | スコア |
|--------|--------|
| Gemini 3 Pro | 91.7% |
| DeepSeek V3.2 Speciale | 89.6% |
| GLM-4.7 (Thinking) | ~89% |
| Kimi K2.5 | 85.0 |
| GLM-4.7 | 84.9 |
| Qwen 3.5 (397B) | 83.6 |

### コスパランキング

```
1. MiniMax M2.5    80.2% @ $1.20/M出力  ← Opus級性能で1/20の価格
2. GLM-5           77.8% @ $3.20/M出力  ← MITライセンス
3. Kimi K2.5       76.8% @ $3.00/M出力  ← オープンソース
4. GLM-4.7         73.8% @ $2.20/M出力  ← Flash版無料
5. Gemini 3.1 Pro  80.6% @ $12.00/M出力
6. Claude Sonnet   79.6% @ $15.00/M出力
7. Claude Opus     80.8% @ $25.00/M出力
```

### 用途別推奨モデル

| 用途 | モデル | 理由 |
|------|--------|------|
| **日常コーディング** | Claude Sonnet 4.6 | Arena Elo 3位、ツール呼び出し最安定 |
| **コスパ最強** | MiniMax M2.5 | Opus 級性能で 1/20 の価格 |
| 複雑な設計・リファクタリング | Claude Opus 4.6 | Arena 1位、最高精度 |
| OSS / セルフホスト | GLM-5 | MIT、77.8% SWE-bench、$1/M 入力 |
| 大量バッチ処理 | GLM-4.7 Flash | 無料 |
| 競技プログラミング的な難問 | Gemini 3.1 Pro | LiveCodeBench トップ級 |
| **要注目 (未リリース)** | DeepSeek V4 | リーク 83.7% SWE-bench |

### 注目トレンド

1. **中国勢オープンソースが急伸** — MiniMax M2.5, GLM-5, Kimi K2.5, Qwen 3.5 が Frontier モデルに匹敵する性能を 1/10〜1/20 の価格で提供
2. **Claude は Arena 人間評価で圧倒的** — ベンチマークスコア以上に「実際に使いやすい」との評価。ツール呼び出しの安定性が高い
3. **DeepSeek V4 が最大の注目株** — 3月初旬リリース予定、リーク値が事実なら全モデル中トップ
4. **モデル使い分け戦略が最適解** — 日常は Sonnet 4.6、複雑タスクは Opus 4.6、大量処理は MiniMax M2.5 / GLM-4.7 Flash

## 競合・類似プロジェクト調査

### 本構想に最も近いプロジェクト

| プロジェクト | 概要 | 本構想との差分 |
|-------------|------|---------------|
| **OpenChamber** | OpenCode のマルチエージェント並列実行 + Web/Desktop UI + worktree 分離 + Cloudflare Tunnel でクロスデバイス | **ほぼ同じ構想**。ただし Discord/Slack 連携なし |
| **cc-connect** | Claude Code/Cursor/Gemini CLI を Slack/Discord/Telegram/LINE 等に橋渡し。音声文字起こし、スケジュールタスク対応 | **Bot Adapter 部分はこれで解決**。WebUI なし |
| **OpenClaw** (191k stars) | 汎用自律 AI エージェント。Slack/Discord/Telegram/WhatsApp/iMessage 対応 | コーディング特化ではない (スキルで対応) |

### WebUI ラッパー (Claude Code 向け)

| プロジェクト | 特徴 |
|-------------|------|
| **exitxio/claude-code-web** | Claude Code を HTTP API 化 + Worker Pool。Slack/Discord 連携可能な設計 |
| **sugyan/claude-code-webui** (675 stars) | React + SSE。プロジェクトディレクトリ選択、会話履歴、ツール権限管理 |
| **siteboon/claudecodeui** | Claude Code/Cursor/Codex/Gemini CLI 対応。セッション自動検出、ファイルエクスプローラ、Git GUI |
| **d-kimuson/claude-code-viewer** | cron スケジュールタスク、画像/PDF アップロード、多言語 UI (日本語対応) |
| **sunpix/claude-code-web** | Nuxt 4 + PWA。音声入力、TTS、ドラッグ&ドロップ |
| **vultuk/claude-code-web** | xterm.js ターミナルエミュレータ + WebSocket。`npx claude-code-web` で即起動 |

### WebUI ラッパー (OpenCode 向け)

| プロジェクト | 特徴 |
|-------------|------|
| **threehymns/opencode-webui** | **Docker Compose 対応**。マルチリポジトリ管理、GitHub PAT でプライベートリポジトリ対応 |
| **bjesus/opencode-web** | SolidJS、バーチャルスクロール、トークン/コスト追跡、32 テーマ |
| **chris-tse/opencode-web** | React + Zustand。リアルタイムストリーミング |
| **joelhooks/opencode-vibe** | Next.js 16 + RSC。OpenCode プロセス自動検出 |

### フルスタック代替エージェント

| プロジェクト | 特徴 |
|-------------|------|
| **OpenHands** (旧 OpenDevin) | フルスタック自己ホスト型コーディングエージェント。Web GUI + Docker サンドボックス + ブラウザ内 VSCode。LLM 非依存 |
| **Goose** (Block/Square) | Apache 2.0。MCP 統合、Docker/K8s サンドボックス。CLI + Desktop アプリ |

### Chat Platform ブリッジ

| プロジェクト | 対応プラットフォーム | 対応エージェント |
|-------------|-------------------|----------------|
| **cc-connect** | Slack, Discord, Telegram, LINE, Feishu, DingTalk, WeChat Work | Claude Code, Cursor, Gemini CLI, Codex |
| **Claude-Code-Remote** | Email, Discord, Telegram | Claude Code |
| **claude-code-slack-bot** | Slack | Claude Code |
| **claude-code-discord** | Discord | Claude Code |

### 結論: Build vs Buy

**完全に自前で構築する必要はない。** 既存プロジェクトの組み合わせ or fork が現実的。

| 要件 | 既存で解決可能 |
|------|--------------|
| WebUI + マルチセッション | **opencode web 本体** or **OpenChamber** |
| Worktree 分離 | **OpenChamber** or **opencode-worktree プラグイン** |
| Discord/Slack 連携 | **cc-connect** (最も多機能) |
| Docker 化 | **threehymns/opencode-webui** (Docker Compose 対応済み) |
| Flutter App | **自前** (REST+SSE 直結、既存プロジェクトなし) |

ただし、**これらを Docker Compose で統合し、QNAP Container Station 上で一発起動できる構成にまとめる**のが本構想の価値。

## 自前実装スコープまとめ

| コンポーネント | 実装 |
|---------------|------|
| WebUI | **不要** (opencode web 組み込み) |
| API Server | **不要** (opencode serve 組み込み) |
| Session Manager | **不要** (opencode 組み込み) |
| Worktree Manager | **不要** (プラグインで対応) |
| Discord/Slack Adapter | **cc-connect で代替可能** (自前も SDK + discord.js / @slack/bolt で容易) |
| Flutter App | **自前** (REST + SSE) |
| **Docker Compose 統合** | **自前** (本構想の核心) |
