import { execFile } from "node:child_process"
import { access } from "node:fs/promises"
import { promisify } from "node:util"
import type { Agent, AgentProcess } from "./types.js"

const execFileAsync = promisify(execFile)

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
  githubToken?: string
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
  private readonly githubToken: string | undefined
  private cleanupTimer: ReturnType<typeof setInterval> | undefined
  private cloneInFlight = new Map<string, Promise<void>>()

  constructor(
    private agent: Agent,
    options: AgentPoolOptions = {},
  ) {
    const start = options.portRangeStart ?? 4097
    this.nextPort = start
    this.portRangeEnd = options.portRangeEnd ?? start + 103
    this.idleTimeoutMs = options.idleTimeoutMs ?? 30 * 60 * 1000
    this.reposPath = options.reposPath ?? "/repos"
    this.githubToken = options.githubToken
  }

  start(): void {
    this.cleanupTimer = setInterval(() => this.cleanup(), 60_000)
  }

  async getOrStart(repoName: string): Promise<AgentProcess> {
    const existing = this.entries.get(repoName)
    if (existing?.process.alive()) {
      existing.lastAccess = new Date()
      return existing.process
    }

    if (existing && !existing.process.alive()) {
      this.freedPorts.push(existing.port)
      this.entries.delete(repoName)
    }

    const port = this.allocatePort()
    const repoPath = `${this.reposPath}/${repoName}`
    await this.ensureCloned(repoName, repoPath)
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

  /**
   * repoPath が存在しなければ GitHub から git clone を実行する。
   * 同一リポジトリへの重複 clone を Promise キャッシュで防止する。
   */
  async ensureCloned(repoName: string, repoPath: string): Promise<void> {
    if (await AgentPool.pathExists(repoPath)) return

    const inflight = this.cloneInFlight.get(repoName)
    if (inflight) {
      await inflight
      return
    }

    const clonePromise = this.cloneRepo(repoName, repoPath)
    this.cloneInFlight.set(repoName, clonePromise)
    try {
      await clonePromise
    } finally {
      this.cloneInFlight.delete(repoName)
    }
  }

  private async cloneRepo(repoName: string, repoPath: string): Promise<void> {
    const url = AgentPool.buildCloneUrl(repoName, this.githubToken)
    try {
      await execFileAsync("git", ["clone", url, repoPath])
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      throw new Error(
        `Failed to clone ${repoName}: ${message.replaceAll(this.githubToken ?? "", "***")}`,
      )
    }
  }

  static buildCloneUrl(repoName: string, token?: string): string {
    if (token) {
      return `https://${token}@github.com/${repoName}.git`
    }
    return `https://github.com/${repoName}.git`
  }

  static async pathExists(path: string): Promise<boolean> {
    try {
      await access(path)
      return true
    } catch {
      return false
    }
  }

  private allocatePort(): number {
    if (this.freedPorts.length > 0) {
      return this.freedPorts.pop() as number
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
