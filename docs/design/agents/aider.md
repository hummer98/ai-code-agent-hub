# Aider Agent 詳細設計

## 対応要求

- [FR-006](../../requirements/README.md) マルチエージェント
- [FR-007](../../requirements/README.md) Agent プロセス管理

## 責務

Aider CLI (`aider`) を `--message` (non-interactive) モードでサブプロセスとして起動し、
リポジトリに対するコーディング操作を実行する Agent 実装。

## 選定理由

OpenCode CLI は QNAP ARM64 (TS-932PX) で動作不可:
- npm バイナリ: Bun/JSC が 64K ページサイズ kernel で Abort
- Go ビルド: wazero (WebAssembly SQLite) が古い kernel (4.x) で SIGILL / disk I/O error

Aider は Python ベースのため ARM64 + 古い kernel でも問題なく動作する。

## プロセス起動

```typescript
// Agent が startProcess() で AiderAgentProcess を生成
const agentProcess = new AiderAgentProcess(repoPath, model)

// prompt() の度に aider CLI を one-shot 起動
const child = spawn("aider", [
  "--model", "openrouter/anthropic/claude-sonnet-4.6",
  "--message", content,
  "--yes",
  "--no-auto-commits",
  "--no-dirty-commits",
  "--no-stream",
  "--no-pretty",
], { cwd: repoPath })
```

### 設計変更理由

OpenCode の SDK サーバーモード (`createOpencodeServer`) は最新 CLI で廃止済み。
OpenCode の `-p` モードも ARM64 QNAP で SQLite (wazero) 互換性問題あり。
Aider の `--message` モードは one-shot subprocess パターンで、外部依存が Python のみ。

## AgentProcess 実装

| メソッド (AgentProcess) | 実装 | 説明 |
|------------------------|------|------|
| `createSession()` | UUID 生成 | セッション ID を発行 |
| `prompt(id, content)` | `aider --message content` spawn | stdout からレスポンスを収集 |
| `resumeSession(id)` | no-op + restore-chat-history フラグ設定 | 次の prompt で `--restore-chat-history` を付与 |
| `destroySession(id)` | sessions Set から削除 | プロセスは毎回 one-shot のため kill 不要 |
| `alive()` | 内部フラグ | `shutdown()` で false に |

## 会話コンテキスト維持

Aider は `--restore-chat-history` フラグで `.aider.chat.history.md` から過去の会話を復元できる。
2回目以降の `prompt()` 呼び出しではこのフラグを自動付与する。

## Discord コマンド

`!` プレフィックスのコマンドを `prompt()` 内で処理する。Aider CLI を起動せずに即座に応答。

| コマンド | 説明 |
|---------|------|
| `!model` | 現在のモデルを表示 |
| `!model <name>` | モデルを変更 (`openrouter/` プレフィックス省略可) |
| `!models` | おすすめモデル一覧をセレクトメニュー UI で表示 |
| `!help` | コマンドヘルプを表示 |

`!models` は `ReplyPayload` (セレクトメニュー付き) を `<!--reply:JSON-->` 形式で返す。
Router がパースして Discord Platform が `StringSelectMenuBuilder` で UI を描画する。

### おすすめモデルリスト (`RECOMMENDED_MODELS`)

8プロバイダ 20+ モデルを収録: Anthropic, OpenAI, Google, DeepSeek, Qwen, Moonshot, Zhipu, Mistral。
Discord のセレクトメニューから直接選択可能。

## 出力フィルタリング

`isAiderStatusLine()` で Aider CLI のステータス出力をフィルタリングし、LLM の応答テキストのみを返す。

除外対象: `Aider v*`, `Main model:`, `Weak model:`, `Tokens:`, `Cost:`, `Git repo:`, `Added * to the chat`, `https://aider.chat/` など。

## LLM プロバイダ

環境変数 `OPENROUTER_API_KEY` + モデル名 `openrouter/anthropic/claude-sonnet-4.6` で OpenRouter 経由。
`AIDER_MODEL` 環境変数でモデルを変更可能。
`AIDER_SYSTEM_PROMPT` 環境変数でシステムプロンプトを変更可能 (デフォルト: `必ず日本語で回答してください。`)。

## Dockerfile

```dockerfile
RUN apt-get install -y python3 python3-pip python3-venv
RUN python3 -m venv /opt/aider && /opt/aider/bin/pip install aider-chat
ENV PATH="/opt/aider/bin:$PATH"
```

## Agent 切り替え

`AGENT` 環境変数で切り替え可能:

| 値 | Agent | 備考 |
|---|---|---|
| `aider` (デフォルト) | AiderAgent | Python, ARM64 対応 |
| `opencode` | OpenCodeAgent | Go, ARM64 非対応 (将来用) |
| `claude-code` | ClaudeCodeAgent | Node.js, ANTHROPIC_API_KEY 必要 |

## 見積もり

~200行
