import type { AgentProcess } from "./types.js"

interface SessionEntry {
  sessionId: string
  repoName: string
  lastAccess: Date
}

/**
 * スレッド ID → セッション ID のマッピングを管理する。
 * タイマーは持たない (プロセスのライフサイクル管理は AgentPool の責務)。
 */
export class SessionPool {
  private sessions = new Map<string, SessionEntry>()

  async getOrCreate(
    threadId: string,
    repoName: string,
    agentProcess: AgentProcess,
  ): Promise<string> {
    const existing = this.sessions.get(threadId)
    if (existing) {
      existing.lastAccess = new Date()
      return existing.sessionId
    }

    const sessionId = await agentProcess.createSession()
    this.sessions.set(threadId, {
      sessionId,
      repoName,
      lastAccess: new Date(),
    })
    return sessionId
  }

  get(threadId: string): string | undefined {
    const entry = this.sessions.get(threadId)
    if (entry) {
      entry.lastAccess = new Date()
    }
    return entry?.sessionId
  }

  getRepoName(threadId: string): string | undefined {
    return this.sessions.get(threadId)?.repoName
  }

  remove(threadId: string): void {
    this.sessions.delete(threadId)
  }

  get size(): number {
    return this.sessions.size
  }
}
