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
    private model: string,
    private readonly systemPrompt: string,
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
    // !model コマンドの処理
    const command = parseCommand(content)
    if (command) {
      yield* this.handleCommand(command)
      return
    }

    const isFirst = this.firstPrompt.get(sessionId) ?? true
    this.firstPrompt.set(sessionId, false)

    const fullMessage = this.systemPrompt ? `${this.systemPrompt}\n\n${content}` : content
    const args = [
      "--model",
      this.model,
      "--message",
      fullMessage,
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

  private async *handleCommand(command: ParsedCommand): AsyncIterable<string> {
    switch (command.name) {
      case "model": {
        if (!command.arg) {
          yield `現在のモデル: \`${this.model}\``
          return
        }
        const newModel = command.arg.startsWith("openrouter/") ? command.arg : `openrouter/${command.arg}`
        this.model = newModel
        yield `モデルを \`${this.model}\` に変更しました。`
        return
      }
      case "models": {
        const current = this.model
        yield [
          "**利用可能なモデル:**",
          ...RECOMMENDED_MODELS.map(
            (m) => `${m.id === current ? "→" : "　"} \`${m.id}\` — ${m.description}`,
          ),
          "",
          `現在: \`${current}\``,
          "変更: `!model <id>` (openrouter/ プレフィックスは省略可)",
        ].join("\n")
        return
      }
      case "help": {
        yield [
          "**利用可能なコマンド:**",
          "`!model` — 現在のモデルを表示",
          "`!model <name>` — モデルを変更",
          "`!models` — おすすめモデル一覧",
          "`!help` — このヘルプを表示",
        ].join("\n")
        return
      }
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

const RECOMMENDED_MODELS = [
  // Anthropic
  { id: "openrouter/anthropic/claude-opus-4.6", description: "最高品質 (Anthropic)" },
  { id: "openrouter/anthropic/claude-sonnet-4.6", description: "高品質・バランス (Anthropic)" },
  { id: "openrouter/anthropic/claude-haiku-4.5", description: "高速・低コスト (Anthropic)" },
  // OpenAI
  { id: "openrouter/openai/gpt-4.1", description: "高品質 (OpenAI)" },
  { id: "openrouter/openai/gpt-4.1-mini", description: "高速・低コスト (OpenAI)" },
  // Google
  { id: "openrouter/google/gemini-2.5-pro", description: "高品質・1Mコンテキスト (Google)" },
  { id: "openrouter/google/gemini-2.5-flash", description: "高速・低コスト (Google)" },
  // DeepSeek
  { id: "openrouter/deepseek/deepseek-v3.2", description: "最安・コーディング◎ (DeepSeek)" },
  { id: "openrouter/deepseek/deepseek-r1", description: "推論特化 (DeepSeek)" },
  // Qwen
  { id: "openrouter/qwen/qwen3.5-plus-02-15", description: "高品質 (Alibaba)" },
  { id: "openrouter/qwen/qwen3-coder-next", description: "コーディング特化 (Alibaba)" },
  // Moonshot
  { id: "openrouter/moonshotai/kimi-k2.5", description: "コーディング◎ (Moonshot)" },
  // Zhipu
  { id: "openrouter/z-ai/glm-5", description: "最新フラッグシップ (Zhipu)" },
  { id: "openrouter/z-ai/glm-4.7-flash", description: "高速・低コスト (Zhipu)" },
] as const

interface ParsedCommand {
  name: string
  arg?: string
}

/**
 * `!command arg` 形式のコマンドをパースする。
 */
function parseCommand(content: string): ParsedCommand | undefined {
  const trimmed = content.trim()
  if (!trimmed.startsWith("!")) return undefined
  const [name, ...rest] = trimmed.slice(1).split(/\s+/)
  if (!name) return undefined
  const validCommands = ["model", "models", "help"]
  if (!validCommands.includes(name)) return undefined
  return { name, arg: rest.join(" ") || undefined }
}

/**
 * aider のステータス/メタ出力行を判定する。
 * レスポンスのテキスト本文のみを返すためにフィルタリングする。
 */
function isAiderStatusLine(line: string): boolean {
  const trimmed = line.trim()
  if (trimmed === "") return true
  if (trimmed === "output") return true
  if (trimmed.startsWith("Aider v")) return true
  if (trimmed.startsWith("Main model:")) return true
  if (trimmed.startsWith("Weak model:")) return true
  if (trimmed.startsWith("Editor model:")) return true
  if (trimmed.startsWith("Git repo:")) return true
  if (trimmed.startsWith("Repo-map:")) return true
  if (trimmed.startsWith("Use /help")) return true
  if (trimmed.startsWith("Tokens:")) return true
  if (trimmed.startsWith("Cost:")) return true
  if (trimmed.startsWith("Added ") && trimmed.endsWith("to the chat")) return true
  if (trimmed.startsWith("Added .aider")) return true
  if (trimmed.startsWith("Update git ")) return true
  if (trimmed.startsWith("You can skip this check")) return true
  if (trimmed.startsWith("https://aider.chat/")) return true
  if (trimmed.startsWith("Model:")) return true
  if (trimmed.startsWith("API:")) return true
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
  private readonly systemPrompt: string

  constructor() {
    this.model = process.env.AIDER_MODEL ?? "openrouter/anthropic/claude-sonnet-4.6"
    this.systemPrompt = process.env.AIDER_SYSTEM_PROMPT ?? "必ず日本語で回答してください。"
  }

  async startProcess(repoPath: string): Promise<AgentProcess> {
    const existing = this.processes.get(repoPath)
    if (existing?.alive()) {
      return existing
    }

    const agentProcess = new AiderAgentProcess(repoPath, this.model, this.systemPrompt)
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
