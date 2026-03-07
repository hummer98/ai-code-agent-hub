import type { ChildProcess } from "node:child_process"
import type { EventEmitter } from "node:events"
import type { Readable } from "node:stream"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { ClaudeCodeAgent, ClaudeCodeAgentProcess } from "../../src/agents/claude-code.js"

// child_process.spawn をモック
vi.mock("node:child_process", () => {
  const { EventEmitter } = require("node:events")
  const { Readable } = require("node:stream")

  return {
    spawn: vi.fn(() => {
      const child = new EventEmitter()
      child.stdout = new Readable({ read() {} })
      child.stderr = new Readable({ read() {} })
      child.exitCode = null
      child.stdin = null
      child.stdio = [null, child.stdout, child.stderr]
      return child
    }),
  }
})

interface MockChildProcess extends EventEmitter {
  stdout: Readable
  stderr: Readable
  exitCode: number | null
}

function jsonLine(obj: Record<string, unknown>): string {
  return `${JSON.stringify(obj)}\n`
}

function createMockChild(): MockChildProcess {
  // Dynamic imports inside vi.mock are cached, use require for consistency
  const { EventEmitter } = require("node:events") as typeof import("node:events")
  const { Readable } = require("node:stream") as typeof import("node:stream")

  const child = new EventEmitter() as MockChildProcess
  child.stdout = new Readable({ read() {} })
  child.stderr = new Readable({ read() {} })
  child.exitCode = null
  return child
}

describe("ClaudeCodeAgentProcess", () => {
  let agentProcess: ClaudeCodeAgentProcess

  beforeEach(() => {
    agentProcess = new ClaudeCodeAgentProcess("/test/repo")
  })

  test("createSession returns a UUID", async () => {
    const sessionId = await agentProcess.createSession()
    expect(sessionId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
  })

  test("createSession returns unique IDs", async () => {
    const id1 = await agentProcess.createSession()
    const id2 = await agentProcess.createSession()
    expect(id1).not.toBe(id2)
  })

  test("createSession with cwd option", async () => {
    const sessionId = await agentProcess.createSession({ cwd: "/custom/path" })
    expect(sessionId).toBeTruthy()
  })

  test("resumeSession is a no-op (does not throw)", async () => {
    await expect(agentProcess.resumeSession("some-session-id")).resolves.toBeUndefined()
  })

  test("destroySession removes the session", async () => {
    const sessionId = await agentProcess.createSession()
    agentProcess.destroySession(sessionId)
    // No error, session is removed from internal tracking
  })

  test("alive returns true by default", () => {
    expect(agentProcess.alive()).toBe(true)
  })

  test("shutdown sets alive to false", () => {
    agentProcess.shutdown()
    expect(agentProcess.alive()).toBe(false)
  })

  test("prompt spawns claude with correct args", async () => {
    const { spawn } = await import("node:child_process")
    const mockSpawn = vi.mocked(spawn)

    const child = createMockChild()
    mockSpawn.mockReturnValueOnce(child as unknown as ChildProcess)

    const sessionId = await agentProcess.createSession()
    const chunks: string[] = []

    // Start reading in background
    const readPromise = (async () => {
      for await (const chunk of agentProcess.prompt(sessionId, "hello world")) {
        chunks.push(chunk)
      }
    })()

    // Emit a JSON line with assistant text
    child.stdout.push(
      jsonLine({
        type: "assistant",
        subtype: "text",
        content_block: { type: "text", text: "Hello from Claude!" },
      }),
    )

    // End the stream and emit close
    child.stdout.push(null)
    child.exitCode = 0
    child.emit("close", 0)

    await readPromise

    // Verify spawn was called correctly
    expect(mockSpawn).toHaveBeenCalledWith(
      "claude",
      ["-p", "hello world", "--session-id", sessionId, "--output-format", "stream-json"],
      expect.objectContaining({
        cwd: "/test/repo",
        stdio: ["ignore", "pipe", "pipe"],
      }),
    )

    expect(chunks).toEqual(["Hello from Claude!"])
  })

  test("prompt yields content_block_delta chunks", async () => {
    const { spawn } = await import("node:child_process")
    const mockSpawn = vi.mocked(spawn)

    const child = createMockChild()
    mockSpawn.mockReturnValueOnce(child as unknown as ChildProcess)

    const sessionId = await agentProcess.createSession()
    const chunks: string[] = []

    const readPromise = (async () => {
      for await (const chunk of agentProcess.prompt(sessionId, "test")) {
        chunks.push(chunk)
      }
    })()

    // Emit content_block_delta type lines
    child.stdout.push(
      jsonLine({
        type: "content_block_delta",
        content_block: { type: "text", text: "chunk1" },
      }),
    )
    child.stdout.push(
      jsonLine({
        type: "content_block_delta",
        content_block: { type: "text", text: "chunk2" },
      }),
    )

    child.stdout.push(null)
    child.exitCode = 0
    child.emit("close", 0)

    await readPromise

    expect(chunks).toEqual(["chunk1", "chunk2"])
  })

  test("prompt ignores non-assistant JSON lines", async () => {
    const { spawn } = await import("node:child_process")
    const mockSpawn = vi.mocked(spawn)

    const child = createMockChild()
    mockSpawn.mockReturnValueOnce(child as unknown as ChildProcess)

    const sessionId = await agentProcess.createSession()
    const chunks: string[] = []

    const readPromise = (async () => {
      for await (const chunk of agentProcess.prompt(sessionId, "test")) {
        chunks.push(chunk)
      }
    })()

    // Emit various non-assistant lines
    child.stdout.push(jsonLine({ type: "system", content: "init" }))
    child.stdout.push(jsonLine({ type: "tool_use", name: "read" }))
    child.stdout.push("not valid json\n")
    child.stdout.push("\n") // empty line
    child.stdout.push(
      jsonLine({
        type: "assistant",
        subtype: "text",
        content_block: { type: "text", text: "real response" },
      }),
    )

    child.stdout.push(null)
    child.exitCode = 0
    child.emit("close", 0)

    await readPromise

    expect(chunks).toEqual(["real response"])
  })
})

describe("ClaudeCodeAgent", () => {
  let agent: ClaudeCodeAgent

  beforeEach(() => {
    agent = new ClaudeCodeAgent()
  })

  test("name is claude-code", () => {
    expect(agent.name).toBe("claude-code")
  })

  test("startProcess creates a new process", async () => {
    const process = await agent.startProcess("/repos/org/repo")
    expect(process).toBeDefined()
    expect(process.alive()).toBe(true)
  })

  test("startProcess returns existing alive process", async () => {
    const first = await agent.startProcess("/repos/org/repo")
    const second = await agent.startProcess("/repos/org/repo")
    expect(first).toBe(second)
  })

  test("startProcess creates new process if existing is dead", async () => {
    const first = await agent.startProcess("/repos/org/repo")
    // Shutdown the process to make it dead
    ;(first as ClaudeCodeAgentProcess).shutdown()

    const second = await agent.startProcess("/repos/org/repo")
    expect(second).not.toBe(first)
    expect(second.alive()).toBe(true)
  })

  test("stopProcess shuts down and removes the process", async () => {
    const process = await agent.startProcess("/repos/org/repo")
    agent.stopProcess("/repos/org/repo")
    expect(process.alive()).toBe(false)
  })

  test("stopProcess is no-op for unknown repo", () => {
    agent.stopProcess("/repos/unknown/repo") // should not throw
  })

  test("manages separate processes per repoPath", async () => {
    const processA = await agent.startProcess("/repos/org/repo-a")
    const processB = await agent.startProcess("/repos/org/repo-b")
    expect(processA).not.toBe(processB)

    agent.stopProcess("/repos/org/repo-a")
    expect(processA.alive()).toBe(false)
    expect(processB.alive()).toBe(true)
  })
})
