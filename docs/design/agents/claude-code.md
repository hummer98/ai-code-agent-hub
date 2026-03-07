# Claude Code Agent 詳細設計

## 対応要求

- [FR-006](../requirements/README.md) マルチエージェント

## 責務

Claude Code CLI (`claude`) をサブプロセスとして起動・管理する Agent 実装。
OpenCode Agent と同じ Agent インターフェースを実装し、差し替え可能にする。

## クラス構成

### ClaudeCodeAgent

`Agent` インターフェースの実装。repoPath 単位で `ClaudeCodeAgentProcess` を管理する。

| メソッド | 動作 |
|---------|------|
| `startProcess(repoPath)` | 指定 repoPath 用の `ClaudeCodeAgentProcess` を生成して返す。既存の alive なプロセスがあれば再利用 |
| `stopProcess(repoPath)` | 対応するプロセスを `shutdown()` して Map から削除 |

### ClaudeCodeAgentProcess

`AgentProcess` インターフェースの実装。`claude` CLI を `child_process.spawn` で呼び出す。

| メソッド | 動作 |
|---------|------|
| `createSession()` | UUID v4 でセッション ID を生成して返す |
| `resumeSession(sessionId)` | no-op。Claude Code CLI は `--session-id` で自動復帰 |
| `prompt(sessionId, content)` | `claude -p "content" --session-id xxx --output-format stream-json` を spawn し、stdout の JSON Lines から `assistant` type のテキストを `AsyncIterable<string>` で yield |
| `destroySession(sessionId)` | 内部の sessions Set から削除 |
| `alive()` | `shutdown()` が呼ばれていなければ `true` |
| `shutdown()` | alive フラグを false にしてセッション一覧をクリア |

## CLI 呼び出し

```
claude -p "<prompt>" --session-id <uuid> --output-format stream-json
```

- `cwd` に repoPath を指定して spawn
- stdout は JSON Lines 形式で出力される
- `node:readline` の `createInterface` で行単位に読み取り
- 以下の type を持つ行からテキストを抽出:
  - `{ type: "assistant", subtype: "text", content_block: { text: "..." } }`
  - `{ type: "content_block_delta", content_block: { text: "..." } }`

## 設計判断

### プロセスモデル

OpenCode Agent は長寿命サーバープロセス (SDK 経由) を管理するのに対し、
Claude Code Agent は `prompt()` 呼び出し毎に `claude` CLI をワンショットで spawn する。
これにより、プロセス管理がシンプルになり、CLI のバージョンアップにも追従しやすい。

### セッション永続化

Claude Code CLI は `--session-id` を指定すると、会話履歴をローカルファイルに保存する。
同じ session ID で再度 CLI を起動すれば会話が継続する。そのため `resumeSession()` は no-op で十分。

## ファイル

- 実装: `src/agents/claude-code.ts`
- テスト: `tests/unit/claude-code.test.ts`
