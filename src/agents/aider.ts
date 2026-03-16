import { type ChildProcess, spawn } from "node:child_process"
import { randomUUID } from "node:crypto"
import { createInterface } from "node:readline"
import type { Agent, AgentProcess } from "../types.js"

/**
 * Aider CLI をサブプロセスとして起動する AgentProcess 実装。
 * `--message` (non-interactive) モードで毎回呼び出す。
 * `--restore-chat-history` で会話コンテキストを維持する。
 */
class AiderAgentProcess implements AgentProcess {
  private sessions = new Set<string>()
  private _alive = true
  private firstPrompt = new Map<string, boolean>()

  constructor(
    private readonly cwd: string,
    private readonly model: string,
  ) {}

  async createSession(_opts?: { cwd?: string }): Promise<string> {
    const sessionId = randomUUID()
    this.sessions.add(sessionId)
    this.firstPrompt.set(sessionId, true)
    return sessionId
  }

  async resumeSession(sessionId: string): Promise<void> {
    this.sessions.add(sessionId)
    // 既存セッションは restore-chat-history で復帰
    this.firstPrompt.set(sessionId, false)
  }

  async *prompt(sessionId: string, content: string): AsyncIterable<string> {
    const isFirst = this.firstPrompt.get(sessionId) ?? true
    this.firstPrompt.set(sessionId, false)

    const args = [
      "--model",
      this.model,
      "--message",
      content,
      "--yes",
      "--no-auto-commits",
      "--no-dirty-commits",
      "--no-stream",
      "--no-pretty",
    ]

    // 2回目以降は会話履歴を復元
    if (!isFirst) {
      args.push("--restore-chat-history")
    }

    const child = spawn("aider", args, {
      cwd: this.cwd,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env },
    })

    yield* this.readOutput(child)
  }

  private async *readOutput(child: ChildProcess): AsyncIterable<string> {
    if (!child.stdout) {
      return
    }

    const lines: string[] = []
    const rl = createInterface({ input: child.stdout })

    try {
      for await (const line of rl) {
        lines.push(line)
      }
    } finally {
      rl.close()
      if (child.exitCode === null) {
        await new Promise<void>((resolve) => {
          child.on("close", resolve)
        })
      }
    }

    // aider の出力からステータス行を除外してレスポンスを抽出
    const output = lines
      .filter((line) => !isAiderStatusLine(line))
      .join("\n")
      .trim()

    if (output) {
      yield output
    }
  }

  destroySession(sessionId: string): void {
    this.sessions.delete(sessionId)
    this.firstPrompt.delete(sessionId)
  }

  alive(): boolean {
    return this._alive
  }

  shutdown(): void {
    this._alive = false
    this.sessions.clear()
    this.firstPrompt.clear()
  }
}

/**
 * aider のステータス/メタ出力行を判定する。
 * レスポンスのテキスト本文のみを返すためにフィルタリングする。
 */
function isAiderStatusLine(line: string): boolean {
  const trimmed = line.trim()
  if (trimmed === "") return true
  if (trimmed.startsWith("Aider v")) return true
  if (trimmed.startsWith("Main model:")) return true
  if (trimmed.startsWith("Git repo:")) return true
  if (trimmed.startsWith("Repo-map:")) return true
  if (trimmed.startsWith("Use /help")) return true
  if (trimmed.startsWith("Tokens:")) return true
  if (trimmed.startsWith("Cost:")) return true
  return false
}

/**
 * Aider CLI (`aider`) を使って Agent プロセスを管理する Agent 実装。
 * 環境変数 AIDER_MODEL でモデルを指定可能（デフォルト: openrouter/anthropic/claude-sonnet-4）。
 */
export class AiderAgent implements Agent {
  name = "aider"
  private processes = new Map<string, AiderAgentProcess>()
  private readonly model: string

  constructor() {
    this.model = process.env.AIDER_MODEL ?? "openrouter/anthropic/claude-sonnet-4"
  }

  async startProcess(repoPath: string): Promise<AgentProcess> {
    const existing = this.processes.get(repoPath)
    if (existing?.alive()) {
      return existing
    }

    const agentProcess = new AiderAgentProcess(repoPath, this.model)
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
