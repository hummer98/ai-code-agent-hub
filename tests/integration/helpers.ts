import type { Agent, AgentProcess, IncomingMessage, Platform, ReplyPayload } from "../../src/types.js"

export class MockAgentProcess implements AgentProcess {
  sessions = new Map<string, { cwd?: string }>()
  private nextId = 1

  async createSession(opts?: { cwd?: string }): Promise<string> {
    const id = `session-${this.nextId++}`
    this.sessions.set(id, { cwd: opts?.cwd })
    return id
  }

  async resumeSession(_sessionId: string): Promise<void> {}

  async *prompt(_sessionId: string, content: string): AsyncIterable<string> {
    yield `echo: ${content}`
  }

  destroySession(sessionId: string): void {
    this.sessions.delete(sessionId)
  }

  alive(): boolean {
    return true
  }
}

export class MockAgent implements Agent {
  name = "mock"
  processes = new Map<string, MockAgentProcess>()

  async startProcess(repoPath: string): Promise<AgentProcess> {
    const process = new MockAgentProcess()
    this.processes.set(repoPath, process)
    return process
  }

  stopProcess(repoPath: string): void {
    this.processes.delete(repoPath)
  }
}

export class TestPlatform implements Platform {
  name = "test"
  private handler!: (msg: IncomingMessage) => void
  replies: Array<{ msg: IncomingMessage; text: string | ReplyPayload }> = []
  threads: Array<{ msg: IncomingMessage; name: string; threadId: string }> = []
  private threadCounter = 0

  async start(): Promise<void> {}
  stop(): void {}

  onMessage(handler: (msg: IncomingMessage) => void): void {
    this.handler = handler
  }

  async reply(msg: IncomingMessage, content: string | ReplyPayload): Promise<void> {
    this.replies.push({ msg, text: content })
  }

  async startThread(msg: IncomingMessage, name: string): Promise<string> {
    const threadId = `test-thread-${++this.threadCounter}`
    this.threads.push({ msg, name, threadId })
    return threadId
  }

  simulateMessage(partial: Partial<IncomingMessage>): void {
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
