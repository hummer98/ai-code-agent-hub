import { type ChildProcess, spawn } from "node:child_process"
import { randomUUID } from "node:crypto"
import { createInterface } from "node:readline"
import type { Agent, AgentProcess } from "../types.js"

/**
 * OpenCode CLI の JSON 出力の型。
 * `-f json` で得られるレスポンスの構造。
 */
interface OpenCodeJsonResponse {
  content?: string
  parts?: Array<{ type: string; text?: string }>
  [key: string]: unknown
}

/**
 * OpenCode CLI をサブプロセスとして起動する AgentProcess 実装。
 * SDK のサーバーモードではなく、`-p` (non-interactive prompt) モードで毎回呼び出す。
 */
class OpenCodeAgentProcess implements AgentProcess {
  private sessions = new Set<string>()
  private _alive = true

  constructor(private readonly cwd: string) {}

  async createSession(_opts?: { cwd?: string }): Promise<string> {
    const sessionId = randomUUID()
    this.sessions.add(sessionId)
    return sessionId
  }

  async resumeSession(sessionId: string): Promise<void> {
    this.sessions.add(sessionId)
  }

  async *prompt(_sessionId: string, content: string): AsyncIterable<string> {
    const args = ["-p", content, "-c", this.cwd, "-f", "json", "-q"]

    const child = spawn("opencode", args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env },
    })

    yield* this.readOutput(child)
  }

  /**
   * child process の stdout を読み取り、テキスト応答を yield する。
   */
  private async *readOutput(child: ChildProcess): AsyncIterable<string> {
    if (!child.stdout) {
      return
    }

    let output = ""
    const rl = createInterface({ input: child.stdout })

    try {
      for await (const line of rl) {
        output += line
      }
    } finally {
      rl.close()
      if (child.exitCode === null) {
        await new Promise<void>((resolve) => {
          child.on("close", resolve)
        })
      }
    }

    // JSON 出力をパースしてテキストを抽出
    if (output.trim()) {
      try {
        const parsed: OpenCodeJsonResponse = JSON.parse(output)
        if (typeof parsed.content === "string") {
          yield parsed.content
        } else if (parsed.parts) {
          for (const part of parsed.parts) {
            if (part.type === "text" && typeof part.text === "string") {
              yield part.text
            }
          }
        } else {
          // フォールバック: JSON をそのまま返す
          yield output.trim()
        }
      } catch {
        // JSON パース失敗時はプレーンテキストとして返す
        yield output.trim()
      }
    }
  }

  destroySession(sessionId: string): void {
    this.sessions.delete(sessionId)
  }

  alive(): boolean {
    return this._alive
  }

  shutdown(): void {
    this._alive = false
    this.sessions.clear()
  }
}

/**
 * OpenCode CLI (`opencode`) を使って Agent プロセスを起動・管理する Agent 実装。
 * 1 repoPath に対して 1 つの OpenCodeAgentProcess を保持する。
 */
export class OpenCodeAgent implements Agent {
  name = "opencode"
  private processes = new Map<string, OpenCodeAgentProcess>()

  async startProcess(repoPath: string): Promise<AgentProcess> {
    const existing = this.processes.get(repoPath)
    if (existing?.alive()) {
      return existing
    }

    const agentProcess = new OpenCodeAgentProcess(repoPath)
    this.processes.set(repoPath, agentProcess)
    return agentProcess
  }

  stopProcess(repoPath: string): void {
    const agentProcess = this.processes.get(repoPath)
    if (agentProcess) {
      agentProcess.shutdown()
      this.processes.delete(repoPath)
    }
  }
}
