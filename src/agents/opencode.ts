import type { Agent, AgentProcess } from "../types.js"

/**
 * @opencode-ai/sdk の型定義 (SDK が利用可能になるまでのスタブ)
 */
interface OpencodeServer {
  url: string
  close(): void
}

interface OpencodeClient {
  session: {
    create(): Promise<{ id: string }>
    prompt(opts: {
      path: { id: string }
      body: { content: string }
    }): Promise<{ content: string }>
    delete(opts: { path: { id: string } }): Promise<void>
  }
  global: {
    event(): AsyncIterable<{ type: string; data: unknown }>
  }
}

/**
 * OpenCode Agent プロセスのラッパー。
 * SDK の OpencodeClient を介してセッションを操作する。
 */
class OpenCodeAgentProcess implements AgentProcess {
  constructor(
    private client: OpencodeClient,
    private server: OpencodeServer,
  ) {}

  async createSession(opts?: { cwd?: string }): Promise<string> {
    const result = await this.client.session.create()
    return result.id
  }

  async resumeSession(_sessionId: string): Promise<void> {
    // opencode はセッションをサーバー側で永続化するため no-op
  }

  async *prompt(sessionId: string, content: string): AsyncIterable<string> {
    const result = await this.client.session.prompt({
      path: { id: sessionId },
      body: { content },
    })
    yield result.content
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
 *
 * SDK がインストールされていない場合はエラーをスローする。
 */
export class OpenCodeAgent implements Agent {
  name = "opencode"
  private servers = new Map<string, OpencodeServer>()

  async startProcess(repoPath: string): Promise<AgentProcess> {
    let createOpencodeServer: (opts: {
      port?: number
      hostname?: string
    }) => Promise<OpencodeServer>
    let createOpencodeClient: (opts: {
      baseUrl: string
    }) => OpencodeClient

    try {
      // @ts-expect-error SDK is an optional runtime dependency
      const sdk = await import("@opencode-ai/sdk")
      createOpencodeServer = sdk.createOpencodeServer
      createOpencodeClient = sdk.createOpencodeClient
    } catch {
      throw new Error(
        "@opencode-ai/sdk is not installed. Run: npm install @opencode-ai/sdk",
      )
    }

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
