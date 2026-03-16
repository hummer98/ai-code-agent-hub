import { App } from "@slack/bolt"
import type { IncomingMessage, Platform, ReplyPayload } from "../types.js"
import { parseRepoFromTopic } from "./parse-topic.js"

/**
 * Slack Socket Mode (WebSocket) を介してメッセージを送受信する Platform 実装。
 * app_mention イベント + スレッド返信方式を採用。
 */
export class SlackPlatform implements Platform {
  name = "slack"
  private app: App
  private handler?: (msg: IncomingMessage) => void

  constructor(botToken: string, appToken: string) {
    this.app = new App({
      token: botToken,
      appToken,
      socketMode: true,
    })
  }

  async start(): Promise<void> {
    this.app.event("app_mention", async ({ event, client }) => {
      if (!this.handler) return

      // Resolve repo from channel topic
      let repoHint: string | undefined
      try {
        const info = await client.conversations.info({ channel: event.channel })
        repoHint = parseRepoFromTopic(
          (info.channel as { topic?: { value?: string } })?.topic?.value,
        )
      } catch {
        // Channel info unavailable
      }

      // Remove bot mention from content
      const content = (event.text ?? "").replace(/<@[A-Z0-9]+>/g, "").trim()

      const incoming: IncomingMessage = {
        platformName: "slack",
        channelId: event.channel,
        threadId: event.thread_ts,
        userId: event.user ?? "",
        content,
        repoHint,
        raw: event,
      }

      this.handler(incoming)
    })

    // Also handle messages in threads (after initial mention)
    this.app.event("message", async ({ event, client }) => {
      if (!this.handler) return
      const msg = event as {
        thread_ts?: string
        text?: string
        user?: string
        channel: string
        bot_id?: string
        subtype?: string
      }

      // Only handle threaded messages, skip bot messages
      if (!msg.thread_ts || msg.bot_id || msg.subtype) return

      let repoHint: string | undefined
      try {
        const info = await client.conversations.info({ channel: msg.channel })
        repoHint = parseRepoFromTopic(
          (info.channel as { topic?: { value?: string } })?.topic?.value,
        )
      } catch {}

      const incoming: IncomingMessage = {
        platformName: "slack",
        channelId: msg.channel,
        threadId: msg.thread_ts,
        userId: msg.user ?? "",
        content: msg.text ?? "",
        repoHint,
        raw: event,
      }

      this.handler(incoming)
    })

    await this.app.start()
    console.log("Slack bot started in Socket Mode")
  }

  stop(): void {
    this.app.stop().catch(() => {})
  }

  onMessage(handler: (msg: IncomingMessage) => void): void {
    this.handler = handler
  }

  async reply(msg: IncomingMessage, content: string | ReplyPayload): Promise<void> {
    const text = typeof content === "string" ? content : content.text
    await this.app.client.chat.postMessage({
      channel: msg.channelId,
      text,
      thread_ts: msg.threadId,
    })
  }

  async startThread(msg: IncomingMessage, name: string): Promise<string> {
    const raw = msg.raw as { ts: string }
    // Slack threads are identified by the parent message's ts
    // Reply to the original message to create a thread
    const result = await this.app.client.chat.postMessage({
      channel: msg.channelId,
      text: `Starting session for ${name}...`,
      thread_ts: raw.ts,
    })
    return raw.ts
  }
}
