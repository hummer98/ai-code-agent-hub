import { describe, test, expect, beforeEach } from "vitest"
import { SessionPool } from "../../src/session-pool.js"
import type { AgentProcess } from "../../src/types.js"

function createMockAgentProcess(): AgentProcess {
  let nextId = 1
  return {
    async createSession() {
      return `session-${nextId++}`
    },
    async resumeSession() {},
    async *prompt(_sessionId: string, content: string) {
      yield `echo: ${content}`
    },
    destroySession() {},
    alive() {
      return true
    },
  }
}

describe("SessionPool", () => {
  let pool: SessionPool
  let mockProcess: AgentProcess

  beforeEach(() => {
    pool = new SessionPool()
    mockProcess = createMockAgentProcess()
  })

  test("getOrCreate creates new session", async () => {
    const sessionId = await pool.getOrCreate(
      "thread-1",
      "org/repo",
      mockProcess,
    )
    expect(sessionId).toBe("session-1")
    expect(pool.size).toBe(1)
  })

  test("getOrCreate returns existing session for same thread", async () => {
    const first = await pool.getOrCreate("thread-1", "org/repo", mockProcess)
    const second = await pool.getOrCreate("thread-1", "org/repo", mockProcess)
    expect(first).toBe(second)
    expect(pool.size).toBe(1)
  })

  test("getOrCreate creates separate sessions for different threads", async () => {
    const a = await pool.getOrCreate("thread-1", "org/repo-a", mockProcess)
    const b = await pool.getOrCreate("thread-2", "org/repo-b", mockProcess)
    expect(a).not.toBe(b)
    expect(pool.size).toBe(2)
  })

  test("get returns sessionId for existing thread", async () => {
    await pool.getOrCreate("thread-1", "org/repo", mockProcess)
    expect(pool.get("thread-1")).toBe("session-1")
  })

  test("get returns undefined for unknown thread", () => {
    expect(pool.get("unknown")).toBeUndefined()
  })

  test("getRepoName returns repoName for existing thread", async () => {
    await pool.getOrCreate("thread-1", "org/repo", mockProcess)
    expect(pool.getRepoName("thread-1")).toBe("org/repo")
  })

  test("getRepoName returns undefined for unknown thread", () => {
    expect(pool.getRepoName("unknown")).toBeUndefined()
  })

  test("remove deletes session mapping", async () => {
    await pool.getOrCreate("thread-1", "org/repo", mockProcess)
    pool.remove("thread-1")
    expect(pool.get("thread-1")).toBeUndefined()
    expect(pool.size).toBe(0)
  })

  test("remove is no-op for unknown thread", () => {
    pool.remove("unknown") // should not throw
    expect(pool.size).toBe(0)
  })
})
