# OpenCode Agent 詳細設計

## 対応要求

- [FR-006](../requirements/README.md) マルチエージェント
- [FR-007](../requirements/README.md) Agent プロセス管理
- [FR-012](../requirements/README.md) ストリーミング応答
- [NFR-008](../requirements/README.md) Worktree セッション分離

## 責務

OpenCode CLI (`opencode`) を `-p` (non-interactive prompt) モードで起動する Agent 実装。

## 現状

**QNAP ARM64 (TS-932PX) では動作不可。** 将来のために実装を保持している。

### ARM64 互換性問題

1. **npm バイナリ** (`opencode-ai`): Bun/JSC が 64K ページサイズ kernel (PAGE_SIZE=65536) で Abort
2. **Go ソースビルド**: ncruces/go-sqlite3 → wazero (WebAssembly ランタイム) が古い kernel (4.x) で:
   - wazero v1.9.0: SIGILL (`getisar0` — CPU feature detection)
   - wazero v1.11.0: SIGILL 修正済みだが `sqlite3: disk I/O error` が残存
3. **SDK サーバーモード** (`createOpencodeServer`): 最新 CLI で `serve` サブコマンド廃止

### 設計変更履歴

1. 初期: SDK (`@opencode-ai/sdk`) の `createOpencodeServer()` でサーバーモード起動
2. SDK → CLI 移行: 最新 CLI で `serve` が廃止されたため `-p` (one-shot prompt) モードに変更
3. SDK 依存を削除、`@opencode-ai/sdk` は不要に

## プロセス起動

```typescript
// prompt() の度に opencode CLI を one-shot 起動
const child = spawn("opencode", [
  "-p", content, "-c", repoPath, "-f", "json", "-q"
])
```

## AgentProcess 実装

| メソッド (AgentProcess) | 実装 | 説明 |
|------------------------|------|------|
| `createSession()` | UUID 生成 | セッション ID を発行 |
| `prompt(id, content)` | `opencode -p content -c cwd -f json -q` spawn | JSON 出力からテキスト抽出 |
| `resumeSession(id)` | no-op | セッション状態は維持されない |
| `destroySession(id)` | sessions Set から削除 | プロセスは毎回 one-shot |
| `alive()` | 内部フラグ | `shutdown()` で false に |

## Worktree セッション分離 (NFR-008)

opencode-worktree プラグイン (`kdco/worktree`) を利用して、セッション毎に独立した作業ディレクトリを提供する。
Dockerfile で `npx ocx add kdco/worktree` によりインストール済み。

### フロー

1. `createSession()` 時にプラグインが `git worktree add` を実行
2. 各セッションが独立ディレクトリで作業 (コンフリクトなし)
3. `destroySession()` 時にプラグインが auto-commit → worktree 削除

### プラグイン設定 (`.opencode/worktree.jsonc`)

```jsonc
{
  "sync": {
    "copyFiles": [".env", ".env.local"],
    "symlinkDirs": ["node_modules"]
  }
}
```

詳細は seed ドキュメント `docs/seeds/multi-claude-code-webui.md` の Worktree セクションを参照。

## インストラクションファイル

OpenCode は起動時にカレントディレクトリから上方向へ以下のファイルを自動探索し、LLM コンテキストに含める。

1. `AGENTS.md` / `CLAUDE.md` (ローカル、上方向に走査)
2. `~/.config/opencode/AGENTS.md` (グローバル)
3. `~/.claude/CLAUDE.md` (Claude Code 互換)

リポジトリに `CLAUDE.md` があれば追加設定なしで読み込まれるため、プロジェクト固有の指示は `CLAUDE.md` に記述すればよい。

## SDK

`@opencode-ai/sdk` を使用してプログラマティックに制御する。

```typescript
import { createOpencodeClient } from "@opencode-ai/sdk"
const client = createOpencodeClient({ baseUrl: `http://localhost:${port}` })
```

## 見積もり

~60行
