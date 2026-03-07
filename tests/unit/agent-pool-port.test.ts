import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { AgentPool } from "../../src/agent-pool.js"
import type { Agent, AgentProcess } from "../../src/types.js"

// Skip clone in all AgentPool port tests — repo is assumed to exist
vi.spyOn(AgentPool, "pathExists").mockResolvedValue(true)

function createMockAgentProcess(isAlive = true): AgentProcess {
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
      return isAlive
    },
  }
}

function createMockAgent(): Agent & {
  processes: Map<string, AgentProcess>
  lastProcess: AgentProcess | undefined
} {
  const processes = new Map<string, AgentProcess>()
  let lastProcess: AgentProcess | undefined
  return {
    name: "mock",
    processes,
    get lastProcess() {
      return lastProcess
    },
    async startProcess(repoPath: string) {
      const process = createMockAgentProcess()
      processes.set(repoPath, process)
      lastProcess = process
      return process
    },
    stopProcess(repoPath: string) {
      processes.delete(repoPath)
    },
  }
}

describe("AgentPool", () => {
  let agent: ReturnType<typeof createMockAgent>
  let pool: AgentPool

  beforeEach(() => {
    agent = createMockAgent()
    pool = new AgentPool(agent, {
      portRangeStart: 5000,
      portRangeEnd: 5010,
      idleTimeoutMs: 1000,
      reposPath: "/test-repos",
    })
  })

  afterEach(() => {
    pool.stopAll()
  })

  test("getOrStart creates a new process", async () => {
    const process = await pool.getOrStart("org/repo")
    expect(process).toBeDefined()
    expect(process.alive()).toBe(true)
    expect(pool.size).toBe(1)
  })

  test("getOrStart reuses existing process", async () => {
    const first = await pool.getOrStart("org/repo")
    const second = await pool.getOrStart("org/repo")
    expect(first).toBe(second)
    expect(pool.size).toBe(1)
  })

  test("ports are assigned sequentially", async () => {
    await pool.getOrStart("org/repo-a")
    await pool.getOrStart("org/repo-b")
    expect(pool.getPort("org/repo-a")).toBe(5000)
    expect(pool.getPort("org/repo-b")).toBe(5001)
  })

  test("freed ports are reused", async () => {
    await pool.getOrStart("org/repo-a")
    await pool.getOrStart("org/repo-b")
    pool.stop("org/repo-a")
    await pool.getOrStart("org/repo-c")
    expect(pool.getPort("org/repo-c")).toBe(5000)
  })

  test("stop removes entry and frees port", async () => {
    await pool.getOrStart("org/repo")
    pool.stop("org/repo")
    expect(pool.size).toBe(0)
    expect(pool.getPort("org/repo")).toBeUndefined()
  })

  test("stopAll clears all entries", async () => {
    await pool.getOrStart("org/repo-a")
    await pool.getOrStart("org/repo-b")
    pool.stopAll()
    expect(pool.size).toBe(0)
  })

  test("listRepos returns active repo names", async () => {
    await pool.getOrStart("org/repo-a")
    await pool.getOrStart("org/repo-b")
    expect(pool.listRepos()).toEqual(["org/repo-a", "org/repo-b"])
  })

  test("getOrStart restarts dead process", async () => {
    const deadProcess = createMockAgentProcess(false)
    agent.startProcess = async (repoPath: string) => {
      const aliveProcess = createMockAgentProcess(true)
      agent.processes.set(repoPath, aliveProcess)
      return aliveProcess
    }

    // Manually set a dead process entry
    const firstProcess = await pool.getOrStart("org/repo")
    // Override alive to return false
    ;(firstProcess as { alive: () => boolean }).alive = () => false

    const restarted = await pool.getOrStart("org/repo")
    expect(restarted.alive()).toBe(true)
    expect(restarted).not.toBe(firstProcess)
  })

  test("stop is no-op for unknown repo", () => {
    pool.stop("unknown/repo") // should not throw
  })
})
