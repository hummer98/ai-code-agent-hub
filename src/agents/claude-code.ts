import { type ChildProcess, spawn } from "node:child_process"
import { randomUUID } from "node:crypto"
import { createInterface } from "node:readline"
import type { Agent, AgentProcess } from "../types.js"

/**
 * Claude Code CLI のストリーミング JSON 出力の 1 行分。
 * `--output-format stream-json` で得られる JSON Lines の型。
 */
interface StreamJsonLine {
  type: string
  subtype?: string
  content_block?: {
    type: string
    text?: string
  }
  [key: string]: unknown
}

/**
 * Claude Code CLI をサブプロセスとして起動し、
 * `--session-id` でセッションを管理する AgentProcess 実装。
 */
export class ClaudeCodeAgentProcess implements AgentProcess {
  private sessions = new Set<string>()
  private _alive = true

  constructor(private readonly cwd: string) {}

  async createSession(opts?: { cwd?: string }): Promise<string> {
    const sessionId = randomUUID()
    this.sessions.add(sessionId)
    return sessionId
  }

  async resumeSession(sessionId: string): Promise<void> {
    // Claude Code CLI はセッション ID をファイルシステムに永続化する。
    // 同じ --session-id を渡すだけで会話が復帰するため no-op。
    this.sessions.add(sessionId)
  }

  async *prompt(sessionId: string, content: string): AsyncIterable<string> {
    const args = ["-p", content, "--session-id", sessionId, "--output-format", "stream-json"]

    const child = spawn("claude", args, {
      cwd: this.cwd,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env },
    })

    yield* this.readStream(child)
  }

  /**
   * child process の stdout から JSON Lines を読み取り、
   * assistant type のテキストを yield する。
   */
  private async *readStream(child: ChildProcess): AsyncIterable<string> {
    if (!child.stdout) {
      return
    }
    const rl = createInterface({ input: child.stdout })

    try {
      for await (const line of rl) {
        if (!line.trim()) continue

        try {
          const parsed: StreamJsonLine = JSON.parse(line)

          // assistant メッセージのテキストブロックを yield
          if (
            parsed.type === "assistant" &&
            parsed.subtype === "text" &&
            typeof parsed.content_block?.text === "string"
          ) {
            yield parsed.content_block.text
          }

          // content_block_delta 形式 (ストリーミング中のチャンク)
          if (
            parsed.type === "content_block_delta" &&
            typeof parsed.content_block?.text === "string"
          ) {
            yield parsed.content_block.text
          }
        } catch {
          // JSON パースに失敗した行は無視
        }
      }
    } finally {
      rl.close()
      // プロセスが完了していなければ終了を待つ
      if (child.exitCode === null) {
        await new Promise<void>((resolve) => {
          child.on("close", resolve)
        })
      }
    }
  }

  destroySession(sessionId: string): void {
    this.sessions.delete(sessionId)
  }

  alive(): boolean {
    return this._alive
  }

  /**
   * このプロセスを無効化する。AgentPool からの停止通知に使う。
   */
  shutdown(): void {
    this._alive = false
    this.sessions.clear()
  }
}

/**
 * Claude Code CLI (`claude`) を使って Agent プロセスを起動・管理する Agent 実装。
 * OpenCode Agent と同じ Agent インターフェースを実装し、差し替え可能。
 *
 * 1 repoPath に対して 1 つの ClaudeCodeAgentProcess を保持する。
 * プロセスは repoPath を cwd として使い、`claude` CLI を呼び出す。
 */
export class ClaudeCodeAgent implements Agent {
  name = "claude-code"
  private processes = new Map<string, ClaudeCodeAgentProcess>()

  async startProcess(repoPath: string): Promise<AgentProcess> {
    const existing = this.processes.get(repoPath)
    if (existing?.alive()) {
      return existing
    }

    const agentProcess = new ClaudeCodeAgentProcess(repoPath)
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
