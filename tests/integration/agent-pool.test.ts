import { describe, test, expect, beforeEach, afterEach } from "vitest"
import { AgentPool } from "../../src/agent-pool.js"
import { MockAgent } from "./helpers.js"

describe("AgentPool integration", () => {
  let agent: MockAgent
  let pool: AgentPool

  beforeEach(() => {
    agent = new MockAgent()
    pool = new AgentPool(agent, {
      portRangeStart: 7000,
      idleTimeoutMs: 100,
      reposPath: "/test-repos",
    })
  })

  afterEach(() => {
    pool.stopAll()
  })

  test("getOrStart passes correct repoPath to agent", async () => {
    await pool.getOrStart("org/my-repo")
    expect(agent.processes.has("/test-repos/org/my-repo")).toBe(true)
  })

  test("multiple repos get separate processes", async () => {
    const a = await pool.getOrStart("org/repo-a")
    const b = await pool.getOrStart("org/repo-b")
    expect(a).not.toBe(b)
    expect(agent.processes.size).toBe(2)
  })

  test("prompt through agent process works", async () => {
    const process = await pool.getOrStart("org/repo")
    const sessionId = await process.createSession()
    const chunks: string[] = []
    for await (const chunk of process.prompt(sessionId, "test input")) {
      chunks.push(chunk)
    }
    expect(chunks.join("")).toBe("echo: test input")
  })

  test("stopAll cleans up agent processes", async () => {
    await pool.getOrStart("org/repo-a")
    await pool.getOrStart("org/repo-b")
    pool.stopAll()
    expect(pool.size).toBe(0)
  })
})
