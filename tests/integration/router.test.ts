import { describe, test, expect, beforeEach } from "vitest"
import { Router } from "../../src/router.js"
import { AgentPool } from "../../src/agent-pool.js"
import { TestPlatform, MockAgent } from "./helpers.js"

describe("Router integration", () => {
  let platform: TestPlatform
  let agent: MockAgent
  let pool: AgentPool
  let router: Router

  beforeEach(() => {
    platform = new TestPlatform()
    agent = new MockAgent()
    pool = new AgentPool(agent, {
      portRangeStart: 6000,
      reposPath: "/test-repos",
    })
    router = new Router([platform], pool)
    router.start()
  })

  test("新規メッセージでスレッド作成 → Agent に prompt → reply", async () => {
    platform.simulateMessage({
      content: "Hello",
      repoHint: "test-org/test-repo",
    })

    // Wait for async handling
    await new Promise((r) => setTimeout(r, 50))

    expect(platform.threads).toHaveLength(1)
    expect(platform.threads[0].name).toBe("test-org/test-repo")

    expect(platform.replies).toHaveLength(1)
    expect(platform.replies[0].text).toContain("echo: Hello")
  })

  test("repoHint 未設定でエラー返信", async () => {
    platform.simulateMessage({ content: "Hello" })

    await new Promise((r) => setTimeout(r, 50))

    expect(platform.replies).toHaveLength(1)
    expect(platform.replies[0].text).toContain("エラー")
    expect(platform.replies[0].text).toContain("リポジトリ")
  })

  test("スレッド内の継続メッセージはスレッド作成しない", async () => {
    // First message creates thread
    platform.simulateMessage({
      content: "Hello",
      repoHint: "test-org/test-repo",
    })
    await new Promise((r) => setTimeout(r, 50))

    const threadId = platform.threads[0].threadId

    // Second message in same thread
    platform.simulateMessage({
      content: "Follow up",
      repoHint: "test-org/test-repo",
      threadId,
    })
    await new Promise((r) => setTimeout(r, 50))

    expect(platform.threads).toHaveLength(1) // No new thread
    expect(platform.replies).toHaveLength(2)
    expect(platform.replies[1].text).toContain("echo: Follow up")
  })

  test("複数リポジトリのメッセージを処理", async () => {
    platform.simulateMessage({
      content: "A",
      repoHint: "org/repo-a",
    })
    await new Promise((r) => setTimeout(r, 50))

    platform.simulateMessage({
      content: "B",
      repoHint: "org/repo-b",
    })
    await new Promise((r) => setTimeout(r, 50))

    expect(pool.size).toBe(2)
    expect(platform.replies).toHaveLength(2)
  })
})
