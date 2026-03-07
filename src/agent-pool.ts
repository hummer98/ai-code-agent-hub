import type { Agent, AgentProcess } from "./types.js"

interface PoolEntry {
  process: AgentProcess
  port: number
  lastAccess: Date
}

export interface AgentPoolOptions {
  portRangeStart?: number
  portRangeEnd?: number
  idleTimeoutMs?: number
  reposPath?: string
}

/**
 * リポジトリ名をキーに Agent プロセスを管理する共有層。
 * ポートの動的割当とアイドルタイムアウトによるプロセス回収を担う。
 */
export class AgentPool {
  private entries = new Map<string, PoolEntry>()
  private freedPorts: number[] = []
  private nextPort: number
  private readonly portRangeEnd: number
  private readonly idleTimeoutMs: number
  private readonly reposPath: string
  private cleanupTimer: ReturnType<typeof setInterval> | undefined

  constructor(
    private agent: Agent,
    options: AgentPoolOptions = {},
  ) {
    const start = options.portRangeStart ?? 4097
    this.nextPort = start
    this.portRangeEnd = options.portRangeEnd ?? start + 103
    this.idleTimeoutMs = options.idleTimeoutMs ?? 30 * 60 * 1000
    this.reposPath = options.reposPath ?? "/repos"
  }

  start(): void {
    this.cleanupTimer = setInterval(() => this.cleanup(), 60_000)
  }

  async getOrStart(repoName: string): Promise<AgentProcess> {
    const existing = this.entries.get(repoName)
    if (existing && existing.process.alive()) {
      existing.lastAccess = new Date()
      return existing.process
    }

    if (existing && !existing.process.alive()) {
      this.freedPorts.push(existing.port)
      this.entries.delete(repoName)
    }

    const port = this.allocatePort()
    const repoPath = `${this.reposPath}/${repoName}`
    const process = await this.agent.startProcess(repoPath)

    this.entries.set(repoName, {
      process,
      port,
      lastAccess: new Date(),
    })

    return process
  }

  getPort(repoName: string): number | undefined {
    return this.entries.get(repoName)?.port
  }

  listRepos(): string[] {
    return Array.from(this.entries.keys())
  }

  stop(repoName: string): void {
    const entry = this.entries.get(repoName)
    if (!entry) return
    this.agent.stopProcess(`${this.reposPath}/${repoName}`)
    this.freedPorts.push(entry.port)
    this.entries.delete(repoName)
  }

  stopAll(): void {
    for (const repoName of this.entries.keys()) {
      this.stop(repoName)
    }
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer)
      this.cleanupTimer = undefined
    }
  }

  get size(): number {
    return this.entries.size
  }

  private allocatePort(): number {
    if (this.freedPorts.length > 0) {
      return this.freedPorts.pop()!
    }
    if (this.nextPort > this.portRangeEnd) {
      throw new Error("Port range exhausted")
    }
    return this.nextPort++
  }

  private cleanup(): void {
    const now = Date.now()
    for (const [repoName, entry] of this.entries) {
      if (now - entry.lastAccess.getTime() > this.idleTimeoutMs) {
        this.stop(repoName)
      }
    }
  }
}
