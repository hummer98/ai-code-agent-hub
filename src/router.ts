import type { Platform, IncomingMessage } from "./types.js"
import type { AgentPool } from "./agent-pool.js"
import { SessionPool } from "./session-pool.js"

/**
 * Platform からのメッセージを Agent にルーティングする中継層。
 * Platform と Agent の具象を知らない。
 */
export class Router {
  private sessionPool = new SessionPool()

  constructor(
    private platforms: Platform[],
    private agentPool: AgentPool,
  ) {}

  start(): void {
    for (const platform of this.platforms) {
      platform.onMessage((msg) => this.handleMessage(platform, msg))
    }
  }

  private async handleMessage(
    platform: Platform,
    msg: IncomingMessage,
  ): Promise<void> {
    if (!msg.repoHint) {
      await platform.reply(
        msg,
        "エラー: リポジトリが指定されていません。チャンネルトピックに repo:owner/name を設定してください。",
      )
      return
    }

    try {
      const agentProcess = await this.agentPool.getOrStart(msg.repoHint)

      let threadId = msg.threadId
      if (!threadId) {
        threadId = await platform.startThread(msg, msg.repoHint)
      }

      const sessionId = await this.sessionPool.getOrCreate(
        threadId,
        msg.repoHint,
        agentProcess,
      )

      let buffer = ""
      for await (const chunk of agentProcess.prompt(sessionId, msg.content)) {
        buffer += chunk
      }

      await platform.reply(msg, buffer)
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error)
      console.error(`Router error: ${errorMessage}`)
      await platform.reply(msg, `エラー: ${errorMessage}`)
    }
  }
}
