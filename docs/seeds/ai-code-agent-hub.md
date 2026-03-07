# AI Code Agent Hub — 設計ドキュメント

## 概要

複数の AI コーディングエージェントセッションを WebUI・Discord・Slack・Flutter アプリから操作する統合ハブ。
Discord チャンネルのトピックにリポジトリ名を書くだけで、そのリポジトリ上で AI エージェントが動作する。
QNAP NAS (Container Station) 上の Docker Compose で一発起動。

## 要件

| 要件 | 内容 |
|------|------|
| マルチリポジトリ | チャンネル毎に異なるリポジトリで動作 |
| マルチセッション | スレッド毎に独立したエージェントセッション |
| マルチクライアント | WebUI, Discord, Slack, Flutter App |
| マルチエージェント | OpenCode / Claude Code 等を差し替え可能 |
| Docker-first | ホストマシンのプロセスに干渉しない |
| モデル非依存 | Anthropic, OpenAI, Google, Ollama 等 75+ プロバイダ対応 |

## アーキテクチャ

### 全体構成

```
┌──────────────────────── Docker Compose ─────────────────────────────┐
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │  ai-code-agent-hub (コンテナ)                               │    │
│  │                                                             │    │
│  │  ┌──────────────┐  ┌──────────────┐                        │    │
│  │  │   Router     │  │   Portal     │                        │    │
│  │  │  Discord     │  │  :3000       │                        │    │
│  │  │  Slack       │  │  リポジトリ   │                        │    │
│  │  │  → Agent中継 │  │  一覧+Proxy  │                        │    │
│  │  └──────┬───────┘  └──────┬───────┘                        │    │
│  │         │                 │                                 │    │
│  │  ┌──────▼─────────────────▼──────────────────────────────┐  │    │
│  │  │  Agent Pool                                           │  │    │
│  │  │                                                       │  │    │
│  │  │  hummer98/my-blog       → opencode serve :4097        │  │    │
│  │  │  hummer98/interview-app → opencode serve :4098        │  │    │
│  │  │  hummer98/new-project   → opencode serve :4099        │  │    │
│  │  │                                                       │  │    │
│  │  │  (アイドル 30分で停止、次回アクセスで再起動)              │  │    │
│  │  │  (セッションは resume で復帰可能)                       │  │    │
│  │  └───────────────────────────────────────────────────────┘  │    │
│  │                                                             │    │
│  │  Volumes:                                                   │    │
│  │  ├─ repos/ (各リポジトリの clone)                           │    │
│  │  ├─ data/  (セッション履歴)                                 │    │
│  │  └─ config/ (設定・プラグイン)                               │    │
│  └─────────────────────────────────────────────────────────────┘    │
│                                                                     │
└──────────┬──────────────────────────────────────────────────────────┘
           │ :3000 (host port mapping)
           │
    ┌──────▼──────┐
    │ Flutter App │ (REST + SSE via Portal)
    └─────────────┘
```

### レイヤー構成

| レイヤー | 責務 | 対象クライアント |
|---------|------|----------------|
| **Portal** | リポジトリ一覧 + opencode web へのリバースプロキシ | ブラウザ, Flutter |
| **Router** | チャットプラットフォーム → Agent 中継 | Discord, Slack |
| **Agent Pool** | opencode プロセスの起動/停止/ポート割当 (共有層) | 全クライアント共通 |
| **Session Pool** | スレッド/タブ → セッション ID マッピング + タイマー回収 | Router 経由のみ |

## プラガブル設計

### コアインターフェース

UI 層 (Platform) と AI エンジン層 (Agent) を Interface で分離する。
Router はどちらの具象も知らない。

```typescript
// ========== Platform (UI層) ==========
interface Platform {
  name: string
  start(): Promise<void>
  stop(): void
  onMessage(handler: (msg: IncomingMessage) => void): void
  reply(msg: IncomingMessage, text: string): Promise<void>
  startThread(msg: IncomingMessage, name: string): Promise<string>
}

// ========== Agent (AIエンジン層) ==========
interface Agent {
  name: string
  startProcess(repoPath: string): Promise<AgentProcess>
  stopProcess(repoPath: string): void
}

interface AgentProcess {
  createSession(opts?: { cwd?: string }): Promise<string>
  resumeSession(sessionId: string): Promise<void>
  prompt(sessionId: string, content: string): AsyncIterable<string>
  destroySession(sessionId: string): void
  alive(): boolean
}

// ========== 共通メッセージ型 ==========
interface IncomingMessage {
  platformName: string
  channelId: string
  threadId?: string
  userId: string
  content: string
  repoHint?: string    // トピック等から解決済みのリポジトリ名
  raw: unknown          // プラットフォーム固有の生データ
}
```

### WebUI を Platform Adapter に含めない理由

```
Platform Adapter の責務:
  「外部プロトコル」→「Agent API」への変換

Discord/Slack:
  チャットプロトコル → [変換が必要] → OpenCode API
  → Platform Adapter が必要

WebUI:
  opencode web が既に「ブラウザ → Agent API」の変換をやっている
  → Adapter を挟む意味がない
  → Portal (リバースプロキシ) で十分
```

## Discord 連携設計

### チャンネルトピックによるリポジトリ解決

Discord のチャンネル名ではなく、**チャンネルトピック**にリポジトリを指定する。

```
チャンネルトピック例:
repo:hummer98/my-blog

他の情報を併記可能:
repo:hummer98/my-blog | branch:main | Next.jsブログ
```

チャンネルトピックの利点:
- 自由テキスト (1024文字まで)
- チャンネルヘッダに常時表示される (人間にも見える)
- API で取得容易 (`channel.topic`)
- 権限で編集者を制限可能
- チャンネル名の制約 (小文字・ハイフンのみ) を受けない

### スレッドベースのセッション管理

```
Discord チャンネル #my-project
├── トピック: "repo:hummer98/my-blog"
│
├── ユーザが @bot にリプライ
│   → スレッド自動作成
│   → トピックから repo を解決
│   → Agent Pool から opencode プロセスを取得 (なければ起動 + clone)
│   → session.create() でセッション作成
│   → スレッド内で会話 (1スレッド = 1セッション)
│
├── スレッド内で継続メッセージ
│   → 既存セッションに session.prompt()
│
└── トピック変更
    → 古い repo の opencode プロセスを停止
    → 新しい repo を clone → 新プロセス起動
```

### セッションライフサイクル

```
作成:  @bot リプライ → スレッド作成 → session.create()
利用:  スレッド内メッセージ → session.prompt()
休止:  アイドル N分 → セッション破棄 (sessionId 保持)
復帰:  スレッド内に再度メッセージ → session.resume(sessionId)
終了:  スレッド archive → sessionId マッピング削除
```

## Slack 連携設計

### 接続方式: Socket Mode

| | Events API (HTTP) | Socket Mode (WS) |
|---|---|---|
| トンネル | 必要 (ngrok 等) | **不要** |
| 3秒ルール | あり | **なし** |
| リトライ処理 | 自前実装 | **SDK が吸収** |
| Marketplace 公開 | 可能 | **不可** |

個人・社内利用では Socket Mode 一択。Events API が必要になるのは Slack App Directory に公開するケースのみ。

### Discord と同じセッションモデル

Slack もスレッドベースでセッションを管理する。
Platform Adapter のインターフェースが共通なため、Router 側のコード変更は不要。

## WebUI 設計

### Portal (リバースプロキシ + リポジトリ一覧)

```
http://nas:3000/                         ← Portal (リポジトリ一覧)
http://nas:3000/repos/my-blog/           ← reverse proxy → opencode :4097
http://nas:3000/repos/interview-app/     ← reverse proxy → opencode :4098
```

opencode web が各リポジトリ毎に起動し、フル機能の WebUI を提供する:
- マルチセッション対応 (一覧・作成・アーカイブ・フォーク)
- チャット UI (ファイル添付、スラッシュコマンド、@メンション)
- ツール実行の可視化 (read, edit, write の折りたたみカード)
- Diff ビュー (split/unified 切り替え)
- モデル/プロバイダ選択
- HTTP Basic Auth 対応

**自前で WebUI を実装する必要はない。** Portal はリポジトリ選択画面 + リバースプロキシだけ (~50行)。

### Flutter App

- Portal の REST API (リポジトリ一覧) + 各 opencode の REST API + SSE を直接利用
- Dart の `http` / `dio` + `eventsource` パッケージで SSE 受信
- サーバ側の追加実装は不要

## ファイル構成

```
src/
├── index.ts              # エントリポイント (組み立て)
├── router.ts             # チャットプラットフォーム → Agent 中継 (~100行)
├── portal.ts             # WebUI 用リバースプロキシ + リポジトリ一覧 (~50行)
├── agent-pool.ts         # opencode プロセス管理 (起動/停止/ポート割当) (~100行)
├── session-pool.ts       # セッション管理 + タイマー回収 (~80行)
├── types.ts              # Platform, Agent, IncomingMessage 型定義
├── platforms/
│   ├── discord.ts        # implements Platform (~80行)
│   └── slack.ts          # implements Platform (~80行)
└── agents/
    ├── opencode.ts       # implements Agent (~60行)
    └── claude-code.ts    # implements Agent (~60行)
```

**合計: ~600行** (テスト・設定除く)

### 組み立て (index.ts)

```typescript
import { Router } from "./router"
import { Portal } from "./portal"
import { AgentPool } from "./agent-pool"
import { DiscordPlatform } from "./platforms/discord"
import { OpenCodeAgent } from "./agents/opencode"

// Agent Pool (共有層)
const agentPool = new AgentPool(
  new OpenCodeAgent({ basePath: "/repos", portRange: [4097, 4200] }),
)

// Router (Discord/Slack → Agent)
const router = new Router(
  [
    new DiscordPlatform({
      token: process.env.DISCORD_TOKEN!,
      categoryId: process.env.DISCORD_CATEGORY_ID!,
    }),
  ],
  agentPool,
  { sessionTimeoutMs: 30 * 60 * 1000 },
)

// Portal (ブラウザ → opencode web proxy)
const portal = new Portal(agentPool, { port: 3000 })

router.start()
portal.start()
```

## Docker Compose 構成

### docker-compose.yml

```yaml
services:
  hub:
    build: .
    ports:
      - "3000:3000"       # Portal (WebUI)
      - "4097-4200:4097-4200"  # opencode プロセス群 (動的割当)
    volumes:
      - ${HUB_REPOS_PATH:-./.hub/repos}:/repos
      - ${HUB_DATA_PATH:-./.hub/data}:/root/.local/share/opencode
      - ${HUB_CONFIG_PATH:-./.hub/config}:/root/.config/opencode
    environment:
      # Discord
      - DISCORD_TOKEN=${DISCORD_TOKEN}
      - DISCORD_CATEGORY_ID=${DISCORD_CATEGORY_ID}
      # Slack (任意)
      - SLACK_BOT_TOKEN=${SLACK_BOT_TOKEN}
      - SLACK_APP_TOKEN=${SLACK_APP_TOKEN}
      # LLM プロバイダ
      - ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}
      - OPENAI_API_KEY=${OPENAI_API_KEY}
      - GOOGLE_API_KEY=${GOOGLE_API_KEY}
      - OPENCODE_ZEN_API_KEY=${OPENCODE_ZEN_API_KEY}
      # Portal 認証
      - PORTAL_PASSWORD=${PORTAL_PASSWORD}
      # GitHub (リポジトリ clone 用)
      - GITHUB_TOKEN=${GITHUB_TOKEN}
      - GITHUB_OWNER=${GITHUB_OWNER:-hummer98}
    restart: unless-stopped
    deploy:
      resources:
        limits:
          memory: 4G
        reservations:
          memory: 1G
```

### Dockerfile

```dockerfile
FROM node:22-slim

RUN apt-get update && apt-get install -y git && rm -rf /var/lib/apt/lists/*
RUN npm install -g opencode

# Worktree プラグイン
RUN npx ocx add kdco/worktree --from https://registry.kdco.dev

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm install
COPY src/ src/
RUN npm run build

EXPOSE 3000
EXPOSE 4097-4200
CMD ["node", "dist/index.js"]
```

### 環境別 .env

```env
# .env.qnap (QNAP NAS)
HUB_REPOS_PATH=/share/Container/ai-code-agent-hub/repos
HUB_DATA_PATH=/share/Container/ai-code-agent-hub/data
HUB_CONFIG_PATH=/share/Container/ai-code-agent-hub/config

# .env.local (ローカル開発)
HUB_REPOS_PATH=./.hub/repos
HUB_DATA_PATH=./.hub/data
HUB_CONFIG_PATH=./.hub/config
```

```bash
cp .env.qnap .env && docker compose up -d
```

### Volume 設計 (QNAP NAS bind mount)

Docker volume ではなく NAS フォルダの bind mount を採用。
コンテナは QNAP 上で動いているため I/O オーバーヘッドの差はゼロ。

| マウント元 (NAS) | マウント先 | 内容 |
|-----------------|-----------|------|
| `.../repos/` | `/repos` | 各リポジトリの clone |
| `.../data/` | `/root/.local/share/opencode` | セッション履歴 |
| `.../config/` | `/root/.config/opencode` | 設定・プラグイン |

bind mount の利点:
- File Station から直接閲覧可能
- NAS バックアップ・スナップショットの対象にそのまま入る
- ファイルコピーで可搬

### メモリ要件

LLM 推論はリモート API で実行。メモリ消費は Node.js ヒープのみ。

| 同時アクティブリポジトリ | 最低限 | 推奨 |
|----------------------|--------|------|
| 1-2 | 1GB | 2GB |
| 3-5 | 2GB | **4GB** |
| 5-10 | 4GB | 8GB |

## Agent Pool 設計

### リポジトリライフサイクル

```
1. 初回アクセス (Discord トピック or Portal)
   → git clone https://github.com/{owner}/{repo} /repos/{repo}
   → opencode serve --port {割当ポート} --cwd /repos/{repo}
   → Agent Pool に登録

2. アクティブ利用
   → session.create() / session.prompt() / session.resume()

3. アイドルタイムアウト (30分)
   → opencode プロセス停止
   → ポート解放
   → リポジトリは /repos/ に残る (再起動は高速)

4. トピック変更 / 手動削除
   → プロセス停止 + リポジトリ削除 (任意)
```

### プロセスプール管理

```typescript
class AgentPool {
  private processes = new Map<string, { process: AgentProcess; port: number; lastAccess: Date }>()
  private nextPort = 4097

  async getOrStart(repoName: string): Promise<AgentProcess> {
    const existing = this.processes.get(repoName)
    if (existing?.process.alive()) {
      existing.lastAccess = new Date()
      return existing.process
    }

    // clone (初回のみ)
    const repoPath = `/repos/${repoName.split("/")[1]}`
    if (!existsSync(repoPath)) {
      await exec(`git clone https://github.com/${repoName} ${repoPath}`)
    }

    // opencode 起動
    const port = this.nextPort++
    const process = await this.agent.startProcess(repoPath, port)
    this.processes.set(repoName, { process, port, lastAccess: new Date() })
    return process
  }

  // タイマーで定期実行
  cleanup(timeoutMs: number) {
    const now = Date.now()
    for (const [repo, entry] of this.processes) {
      if (now - entry.lastAccess.getTime() > timeoutMs) {
        entry.process.stop()
        this.processes.delete(repo)
      }
    }
  }
}
```

## 競合・類似プロジェクトとの位置づけ

| プロジェクト | 本構想との関係 |
|-------------|--------------|
| **OpenChamber** | マルチエージェント並列 + worktree。最も近いが Discord/Slack 連携なし |
| **cc-connect** | Chat Platform ブリッジ。しかし 1 bot = 1 repo 固定、チャンネルルーティング未対応 (Issue #20) |
| **OpenClaw** (191k stars) | 汎用自律 AI エージェント。コーディング特化ではない |
| **opencode web** | WebUI + API。本構想では Agent Pool の各プロセスとして使用 |
| **threehymns/opencode-webui** | Docker 対応 WebUI。参考にするが Portal で代替 |

**本構想の独自価値:** Discord トピック → リポジトリ動的ルーティング + プロセスプール + Docker 一発起動の統合。

## AI コーディングモデル選定

OpenCode はモデル非依存 (75+ プロバイダ対応)。用途に応じた使い分けを推奨。

### 用途別推奨

| 用途 | モデル | 理由 |
|------|--------|------|
| **日常コーディング** | Claude Sonnet 4.6 | Arena Elo 3位、ツール呼び出し最安定 |
| **コスパ最強** | MiniMax M2.5 | SWE-bench 80.2%、Opus の 1/20 の価格 ($0.30/$1.20) |
| 複雑な設計 | Claude Opus 4.6 | Arena 1位、SWE-bench 80.8% |
| OSS / セルフホスト | GLM-5 | MIT、SWE-bench 77.8%、$1.00/$3.20 |
| 大量バッチ処理 | GLM-4.7 Flash | 無料 |
| **要注目** | DeepSeek V4 | リーク SWE-bench 83.7%、2026/03 リリース予定 |

### OpenCode Zen

OpenCode チーム運営のモデルゲートウェイ。35+ モデルをコーディングエージェント用にテスト済み。
API キー 1 つで全プロバイダに接続。一部モデルが期間限定で無料 (MiniMax M2.5, GLM-4.7 等)。

## 自前実装スコープ

| コンポーネント | 実装 | 見積もり |
|---------------|------|---------|
| Router | 自前 | ~100行 |
| Portal | 自前 | ~50行 |
| Agent Pool | 自前 | ~100行 |
| Session Pool | 自前 | ~80行 |
| Discord Adapter | 自前 | ~80行 |
| Slack Adapter | 自前 | ~80行 |
| OpenCode Agent | 自前 | ~60行 |
| 型定義 | 自前 | ~50行 |
| **合計** | | **~600行** |
| WebUI | **不要** (opencode web 組み込み) | — |
| API Server | **不要** (opencode serve 組み込み) | — |
| Worktree Manager | **不要** (プラグインで対応) | — |

## 技術スタック

| カテゴリ | 技術 |
|---------|------|
| ランタイム | Node.js 22 |
| 言語 | TypeScript |
| AI エンジン | OpenCode (差し替え可能) |
| Discord | discord.js |
| Slack | @slack/bolt (Socket Mode) |
| HTTP Server | Hono |
| Reverse Proxy | http-proxy-middleware |
| コンテナ | Docker Compose |
| デプロイ先 | QNAP Container Station |
