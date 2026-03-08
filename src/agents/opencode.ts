import type { OpencodeClient, createOpencodeServer } from "@opencode-ai/sdk"
import type { Agent, AgentProcess } from "../types.js"

type OpencodeServer = Awaited<ReturnType<typeof createOpencodeServer>>

/**
 * OpenCode Agent プロセスのラッパー。
 * SDK の OpencodeClient を介してセッションを操作する。
 */
class OpenCodeAgentProcess implements AgentProcess {
  constructor(
    private client: OpencodeClient,
    private server: OpencodeServer,
  ) {}

  async createSession(_opts?: { cwd?: string }): Promise<string> {
    const result = await this.client.session.create()
    if (result.error) {
      throw new Error("Failed to create opencode session")
    }
    return result.data.id
  }

  async resumeSession(_sessionId: string): Promise<void> {
    // opencode はセッションをサーバー側で永続化するため no-op
  }

  async *prompt(sessionId: string, content: string): AsyncIterable<string> {
    const result = await this.client.session.prompt({
      path: { id: sessionId },
      body: { parts: [{ type: "text", text: content }] },
    })
    if (result.error) {
      throw new Error("Failed to prompt opencode session")
    }
    for (const part of result.data.parts) {
      if (part.type === "text") {
        yield part.text
      }
    }
  }

  destroySession(sessionId: string): void {
    this.client.session.delete({ path: { id: sessionId } }).catch(() => {})
  }

  alive(): boolean {
    return this.server.url !== ""
  }
}

/**
 * @opencode-ai/sdk の createOpencodeServer/createOpencodeClient で
 * Agent プロセスを起動・管理する Agent 実装。
 */
export class OpenCodeAgent implements Agent {
  name = "opencode"
  private servers = new Map<string, OpencodeServer>()

  async startProcess(repoPath: string): Promise<AgentProcess> {
    const { createOpencodeServer, createOpencodeClient } = await import("@opencode-ai/sdk")

    const server = await createOpencodeServer({ hostname: "127.0.0.1" })
    const client = createOpencodeClient({ baseUrl: server.url })

    this.servers.set(repoPath, server)
    return new OpenCodeAgentProcess(client, server)
  }

  stopProcess(repoPath: string): void {
    const server = this.servers.get(repoPath)
    if (server) {
      server.close()
      this.servers.delete(repoPath)
    }
  }
}
