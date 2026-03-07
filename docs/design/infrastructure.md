# インフラ詳細設計

## 対応要求

- [FR-010](../requirements/README.md) Docker 一発起動
- [NFR-001](../requirements/README.md) Docker 隔離
- [NFR-002](../requirements/README.md) メモリ制限
- [NFR-005](../requirements/README.md) QNAP 互換
- [NFR-006](../requirements/README.md) セッション永続化

## Docker Compose 構成

単一コンテナ (hub) で全コンポーネントを稼働させる。

```yaml
services:
  hub:
    build: .
    ports:
      - "3000:3000"              # Portal (WebUI)
      - "4097-4200:4097-4200"    # Agent プロセス群 (動的割当)
    volumes:
      - ${HUB_REPOS_PATH:-./.hub/repos}:/repos
      - ${HUB_DATA_PATH:-./.hub/data}:/root/.local/share/opencode
      - ${HUB_CONFIG_PATH:-./.hub/config}:/root/.config/opencode
    env_file:
      - .env
    restart: unless-stopped
    deploy:
      resources:
        limits:
          memory: 4G             # NFR-002: 3-5 リポ同時で 4GB 以内
        reservations:
          memory: 1G
```

### なぜ単一コンテナか

seed の初期構想 (`multi-claude-code-webui.md`) では opencode / discord-bot / slack-bot の3コンテナ構成だったが、
マルチリポジトリ対応に発展させた `ai-code-agent-hub.md` で単一コンテナに変更した。
理由: Agent Pool が複数の opencode プロセスを動的に起動/停止するため、プロセス管理を同一コンテナ内に収める方が自然。

## Dockerfile

マルチステージビルドで最終イメージサイズを削減。

```dockerfile
FROM node:22-slim AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm install
COPY src/ src/
COPY tsconfig.json ./
RUN npx tsc

FROM node:22-slim
RUN apt-get update && apt-get install -y git && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm install --omit=dev
COPY --from=builder /app/dist dist/
EXPOSE 3000
EXPOSE 4097-4200
CMD ["node", "dist/index.js"]
```

## Volume 設計 (QNAP NAS bind mount)

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

## 環境変数

| 変数 | 必須 | 説明 |
|------|------|------|
| `DISCORD_TOKEN` | △ | Discord Bot トークン (Discord 連携時) |
| `DISCORD_CATEGORY_ID` | △ | 監視対象の Discord カテゴリ ID |
| `SLACK_BOT_TOKEN` | △ | Slack Bot User OAuth Token (Slack 連携時) |
| `SLACK_APP_TOKEN` | △ | Slack App-Level Token (Socket Mode 用) |
| `ANTHROPIC_API_KEY` | △ | Anthropic API キー (LLM プロバイダ) |
| `OPENAI_API_KEY` | △ | OpenAI API キー |
| `GOOGLE_API_KEY` | △ | Google API キー |
| `OPENCODE_ZEN_API_KEY` | △ | OpenCode Zen ゲートウェイキー (全プロバイダ一括) |
| `PORTAL_PASSWORD` | △ | Portal の HTTP Basic Auth パスワード |
| `GITHUB_TOKEN` | △ | GitHub Personal Access Token (プライベートリポジトリ clone 用) |
| `GITHUB_OWNER` | - | デフォルトのリポジトリオーナー (デフォルト: `hummer98`) |
| `HUB_REPOS_PATH` | - | repos Volume のホスト側パス (デフォルト: `./.hub/repos`) |
| `HUB_DATA_PATH` | - | data Volume のホスト側パス (デフォルト: `./.hub/data`) |
| `HUB_CONFIG_PATH` | - | config Volume のホスト側パス (デフォルト: `./.hub/config`) |
| `E2E_TEST_BOT_TOKEN` | - | E2E テスト用 Discord Bot トークン (テスト時のみ) |
| `E2E_TARGET_BOT_ID` | - | E2E テスト対象 Bot のユーザ ID (テスト時のみ) |
| `E2E_DISCORD_CHANNEL_ID` | - | E2E テスト用 Discord チャンネル ID (テスト時のみ) |
| `E2E_DISCORD_GUILD_ID` | - | E2E テスト用 Discord サーバー ID (テスト時のみ) |

## 環境別 .env

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

## デプロイ状況

QNAP NAS (TS-932PX) の Container Station 上で Docker Compose により稼働中。

| 項目 | 値 |
|------|-----|
| ホスト | QNAP TS-932PX |
| ランタイム | Container Station (Docker Compose) |
| Portal ポート | 3000 |
| Agent ポート範囲 | 4097-4200 |
| Volume ベースパス | `/share/Container/ai-code-agent-hub/` |
| メモリ上限 | 4GB (deploy.resources.limits.memory) |

### Volume mount 一覧

| ホスト側パス | コンテナ側パス | 内容 | 永続化対象 |
|-------------|--------------|------|-----------|
| `${HUB_REPOS_PATH}` | `/repos` | 各リポジトリの clone | Yes (NFR-006) |
| `${HUB_DATA_PATH}` | `/root/.local/share/opencode` | セッション履歴 | Yes (NFR-006) |
| `${HUB_CONFIG_PATH}` | `/root/.config/opencode` | 設定・プラグイン | Yes (NFR-006) |

コンテナ再起動時もこれらの bind mount によりデータが保持される (NFR-006)。

## メモリ要件

LLM 推論はリモート API で実行。メモリ消費は Node.js ヒープのみ。

| 同時アクティブリポジトリ | 最低限 | 推奨 |
|----------------------|--------|------|
| 1-2 | 1GB | 2GB |
| 3-5 | 2GB | **4GB** |
| 5-10 | 4GB | 8GB |
