# テスト戦略 詳細設計

## 対応要求

全要求の受け入れ条件検証に関わる横断的設計ドキュメント。

## 概要

AI Code Agent Hub のテスト戦略。Interface 分離の設計原則を活かし、
外部サービス (Discord/Slack/GitHub) への依存を最小化しつつ、
全フローの信頼性を担保する。

## テストピラミッド

```
            /  E2E (Bot-to-Bot)  \        ← 実 Discord/Slack サーバー
           /   少数・スモークテスト  \       CI では省略可 (手動 or nightly)
          /---------------------------\
         / Integration (TestPlatform)  \   ← Discord/Slack 不要
        /  Router+AgentPool+MockAgent   \  CI のメインターゲット
       /----------------------------------\
      /          Unit (vitest)             \ ← 純関数・クラス単体
     / parseRepoFromTopic, SessionPool 等   \
    /------------------------------------------\
```

## 設計判断

### Slash Commands を使わない

Discord 設計 (`docs/design/platforms/discord.md`) では `@bot` メンション + スレッド返信の
**メッセージベース** インタラクションを採用している。Slash Commands を採用しない理由:

| 観点 | Slash Commands | メッセージベース (@bot) |
|------|---------------|----------------------|
| Bot API でのトリガー | 不可 (Interaction はクライアント限定) | 可 (`channel.send()`) |
| E2E テスト自動化 | 極めて困難 | Bot-to-Bot で完全自動化可能 |
| グローバル登録の伝播 | 最大1時間 | 即座に反応 |
| UX (自動補完) | あり | なし (メンション必要) |

このプロジェクトの主要ユースケースは「スレッド内で会話を続ける」であり、
初回の `@bot` メンションでスレッドが始まれば十分。テスト容易性を優先する。

### Playwright + Discord Web を使わない

Discord ToS でユーザーアカウントの自動操作 (self-bot) は明確に禁止されている。
ブラウザ自動化による Discord Web の操作はアカウント停止のリスクがある。
メッセージベース設計により Bot API で全フローをテストできるため、ブラウザ経由は不要。

参考: https://support.discord.com/hc/en-us/articles/115002192352-Automated-User-Accounts-Self-Bots

## Layer 1: Unit テスト

**ツール:** vitest
**対象:** 純関数・状態管理クラス
**外部依存:** なし

### テスト対象

| モジュール | テスト内容 |
|-----------|-----------|
| `parseRepoFromTopic` | トピック文字列パース (`repo:owner/name` 抽出、エッジケース) |
| `SessionPool` | Map 操作 (getOrCreate, get, remove)、セッション ID 保持 |
| `AgentPool` (ポート管理) | ポート割当・解放・再利用ロジック |
| `IncomingMessage` 変換 | Discord/Slack の生データ → 正規化メッセージ |

### 例

```typescript
import { describe, test, expect } from "vitest"
import { parseRepoFromTopic } from "../src/platforms/parse-topic"

describe("parseRepoFromTopic", () => {
  test("extracts repo from topic", () => {
    expect(parseRepoFromTopic("repo:hummer98/my-blog")).toBe("hummer98/my-blog")
  })

  test("extracts repo with extra metadata", () => {
    expect(parseRepoFromTopic("repo:hummer98/my-blog | branch:main | Next.js")).toBe("hummer98/my-blog")
  })

  test("returns undefined for topic without repo", () => {
    expect(parseRepoFromTopic("general discussion")).toBeUndefined()
  })

  test("returns undefined for empty topic", () => {
    expect(parseRepoFromTopic("")).toBeUndefined()
    expect(parseRepoFromTopic(undefined)).toBeUndefined()
  })
})
```

## Layer 2: Integration テスト

**ツール:** vitest
**対象:** Router → AgentPool → SessionPool → Agent の結合フロー
**外部依存:** なし (TestPlatform + MockAgent で代替)

### Interface 分離を活かしたテストダブル

Platform Interface と Agent Interface の抽象があるため、
Discord/Slack 接続や opencode プロセスなしで全フローをテストできる。

#### TestPlatform

```typescript
import type { Platform, IncomingMessage } from "../src/types"

class TestPlatform implements Platform {
  name = "test"
  private handler!: (msg: IncomingMessage) => void
  replies: Array<{ msg: IncomingMessage; text: string }> = []
  threads: Array<{ msg: IncomingMessage; name: string; threadId: string }> = []

  async start() {}
  stop() {}
  onMessage(handler: (msg: IncomingMessage) => void) { this.handler = handler }

  async reply(msg: IncomingMessage, text: string) {
    this.replies.push({ msg, text })
  }

  async startThread(msg: IncomingMessage, name: string) {
    const threadId = `test-thread-${Date.now()}`
    this.threads.push({ msg, name, threadId })
    return threadId
  }

  // テストからメッセージを注入
  simulateMessage(partial: Partial<IncomingMessage>) {
    this.handler({
      platformName: "test",
      channelId: "ch-1",
      userId: "u-1",
      content: "",
      raw: {},
      ...partial,
    } as IncomingMessage)
  }
}
```

#### MockAgent / MockAgentProcess

```typescript
import type { Agent, AgentProcess } from "../src/types"

class MockAgentProcess implements AgentProcess {
  sessions = new Map<string, { cwd?: string }>()
  private nextId = 1

  async createSession(opts?: { cwd?: string }) {
    const id = `session-${this.nextId++}`
    this.sessions.set(id, { cwd: opts?.cwd })
    return id
  }
  async resumeSession(sessionId: string) {}
  async *prompt(sessionId: string, content: string): AsyncIterable<string> {
    yield `echo: ${content}`
  }
  destroySession(sessionId: string) { this.sessions.delete(sessionId) }
  alive() { return true }
}

class MockAgent implements Agent {
  name = "mock"
  processes = new Map<string, MockAgentProcess>()

  async startProcess(repoPath: string) {
    const process = new MockAgentProcess()
    this.processes.set(repoPath, process)
    return process
  }
  stopProcess(repoPath: string) { this.processes.delete(repoPath) }
}
```

### テストシナリオ

| シナリオ | 検証内容 |
|---------|---------|
| 新規メッセージ (repoHint あり) | AgentPool.getOrStart → createSession → prompt → reply |
| 継続メッセージ (threadId あり) | SessionPool から既存セッション取得 → prompt → reply |
| セッション復帰 | プロセス再起動後に resumeSession が呼ばれる |
| repoHint 未設定 | エラーメッセージが reply される |
| AgentProcess 起動失敗 | エラーメッセージが reply される + ログ出力 |
| アイドルタイムアウト | cleanup() 実行後にプロセスが停止される |
| ストリーミング応答 | AsyncIterable のチャンクが逐次 reply される |

### 例

```typescript
import { describe, test, expect, beforeEach } from "vitest"
import { Router } from "../src/router"
import { AgentPool } from "../src/agent-pool"
import { TestPlatform, MockAgent } from "./helpers"

describe("Router integration", () => {
  let platform: TestPlatform
  let agent: MockAgent
  let router: Router

  beforeEach(() => {
    platform = new TestPlatform()
    agent = new MockAgent()
    const agentPool = new AgentPool(agent)
    router = new Router([platform], agentPool)
  })

  test("新規メッセージでスレッド作成 → Agent に prompt → reply", async () => {
    platform.simulateMessage({
      content: "Hello",
      repoHint: "test-org/test-repo",
    })

    // スレッドが作成された
    expect(platform.threads).toHaveLength(1)

    // Agent に prompt が送られ reply が返った
    expect(platform.replies).toHaveLength(1)
    expect(platform.replies[0].text).toContain("echo: Hello")
  })

  test("repoHint 未設定でエラー返信", async () => {
    platform.simulateMessage({ content: "Hello" })

    expect(platform.replies).toHaveLength(1)
    expect(platform.replies[0].text).toContain("エラー")
  })
})
```

## Layer 3: E2E テスト (Bot-to-Bot)

**ツール:** vitest + discord.js
**対象:** 実 Discord サーバーでのメッセージ → スレッド → 応答フロー
**外部依存:** Discord API、テスト用 Discord サーバー、テスト用 Bot

### 方針

- CI ではスキップ (nightly or 手動実行)
- テスト専用 Discord サーバーを使用
- テスト用 Bot (ADMIN 権限) がメッセージ送信・検証・クリーンアップを担う
- jest-discord のアプローチを参考に、vitest 向けに自前実装 (~100行)

### テスト用 Discord サーバー構成

```
E2E テスト専用サーバー
├── テスト Bot (ADMIN 権限) — メッセージ送信・検証・クリーンアップ
├── 本番 Bot (通常権限) — テスト対象
├── #e2e-test (topic: "repo:test-org/e2e-fixture")
└── fixture: GitHub 上の軽量テスト用リポジトリ
```

### 環境変数

```env
E2E_TEST_BOT_TOKEN=       # テスト用 Bot トークン
E2E_TARGET_BOT_ID=        # テスト対象 Bot のユーザ ID
E2E_DISCORD_CHANNEL_ID=   # テスト用チャンネル ID
E2E_DISCORD_GUILD_ID=     # テスト用サーバー ID
```

### クリーンアップ戦略

Discord Bot API で以下がすべてプログラマティックに可能:

| 操作 | API | 制約 |
|------|-----|------|
| メッセージ削除 | `message.delete()` | Bot 自身のメッセージは無制限 |
| メッセージ一括削除 | `channel.bulkDelete()` | 14日以内、100件/回 |
| スレッド削除 | `thread.delete()` | MANAGE_THREADS 権限 |
| チャンネル作成/削除 | `guild.channels.create/delete()` | MANAGE_CHANNELS 権限 |

**推奨パターン:** テスト毎にスレッドを作成 → afterEach でスレッド削除

### 例

```typescript
import { describe, test, expect, beforeAll, afterAll, afterEach } from "vitest"
import { Client, GatewayIntentBits, type TextChannel, type ThreadChannel } from "discord.js"

const testBot = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
})

const createdThreads: ThreadChannel[] = []

beforeAll(async () => {
  await testBot.login(process.env.E2E_TEST_BOT_TOKEN!)
})

afterEach(async () => {
  // スレッドを削除してクリーンアップ
  for (const thread of createdThreads) {
    await thread.delete().catch(() => {})
  }
  createdThreads.length = 0
})

afterAll(async () => {
  await testBot.destroy()
})

describe("Discord E2E", () => {
  test("@bot メンションでスレッドが作成され応答が返る", async () => {
    const channel = (await testBot.channels.fetch(
      process.env.E2E_DISCORD_CHANNEL_ID!,
    )) as TextChannel

    // @bot メンションを送信
    const msg = await channel.send(`<@${process.env.E2E_TARGET_BOT_ID!}> hello`)

    // スレッド作成を待機
    const thread = await waitForThread(channel, msg.id, 30_000)
    expect(thread).toBeDefined()
    createdThreads.push(thread!)

    // スレッド内に応答があることを確認
    const reply = await waitForReply(thread!, process.env.E2E_TARGET_BOT_ID!, 60_000)
    expect(reply.content).toBeTruthy()

    // 送信メッセージも削除
    await msg.delete().catch(() => {})
  }, 90_000)
})

// --- ヘルパー ---

function waitForThread(channel: TextChannel, messageId: string, timeoutMs: number) {
  return new Promise<ThreadChannel | undefined>((resolve) => {
    const timer = setTimeout(() => resolve(undefined), timeoutMs)
    testBot.on("threadCreate", (thread) => {
      // メッセージに紐づくスレッドか確認
      if (thread.parentId === channel.id) {
        clearTimeout(timer)
        resolve(thread as ThreadChannel)
      }
    })
  })
}

function waitForReply(thread: ThreadChannel, botId: string, timeoutMs: number) {
  return new Promise<{ content: string }>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Reply timeout")), timeoutMs)
    testBot.on("messageCreate", (msg) => {
      if (msg.channel.id === thread.id && msg.author.id === botId) {
        clearTimeout(timer)
        resolve({ content: msg.content })
      }
    })
  })
}
```

## Slack E2E テスト

Slack も同じ戦略で Bot-to-Bot テストが可能。

- テスト用 Slack ワークスペース (or 専用チャンネル)
- テスト Bot が `chat.postMessage` でメッセージ送信
- `conversations.replies` でスレッド応答を取得
- `chat.delete` でクリーンアップ

Platform Interface が共通のため、Integration テスト (Layer 2) で主要フローは
カバー済み。Slack E2E は Discord E2E と同等のスモークテストのみで十分。

## Portal E2E テスト

Portal は HTTP サーバーなので、テスト容易性が高い。

```typescript
import { describe, test, expect } from "vitest"

describe("Portal", () => {
  test("GET /api/repos はリポジトリ一覧を返す", async () => {
    const res = await fetch("http://localhost:3000/api/repos")
    expect(res.status).toBe(200)
    const repos = await res.json()
    expect(Array.isArray(repos)).toBe(true)
  })

  test("PORTAL_PASSWORD 設定時に認証なしで 401", async () => {
    const res = await fetch("http://localhost:3000/api/repos")
    expect(res.status).toBe(401)
  })

  test("Basic Auth で認証成功", async () => {
    const res = await fetch("http://localhost:3000/api/repos", {
      headers: { Authorization: `Basic ${btoa("admin:test-password")}` },
    })
    expect(res.status).toBe(200)
  })
})
```

## テスト実行構成

### vitest.config.ts

```typescript
import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    exclude: ["tests/e2e/**"],  // E2E はデフォルトで除外
  },
})
```

### npm scripts

```json
{
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "test:e2e": "vitest run --config vitest.e2e.config.ts"
  }
}
```

### ディレクトリ構成

```
tests/
├── unit/
│   ├── parse-topic.test.ts
│   ├── session-pool.test.ts
│   └── agent-pool-port.test.ts
├── integration/
│   ├── helpers.ts              # TestPlatform, MockAgent
│   ├── router.test.ts
│   └── agent-pool.test.ts
└── e2e/
    ├── discord.e2e.test.ts
    ├── slack.e2e.test.ts
    └── portal.e2e.test.ts
```

## CI 戦略

| テスト | トリガー | 所要時間 | 外部依存 |
|--------|---------|---------|---------|
| Unit + Integration | push / PR | ~10秒 | なし |
| Portal E2E | push / PR | ~5秒 | Docker (ローカル起動) |
| Discord/Slack E2E | nightly / 手動 | ~2分 | 実サーバー + テスト Bot |
