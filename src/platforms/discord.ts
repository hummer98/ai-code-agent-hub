import {
  Client,
  GatewayIntentBits,
  type Message,
  type TextChannel,
  type ThreadChannel,
} from "discord.js"
import type { Platform, IncomingMessage } from "../types.js"
import { parseRepoFromTopic } from "./parse-topic.js"

/**
 * Discord Gateway (WebSocket) を介してメッセージを送受信する Platform 実装。
 * @bot メンション + スレッド返信方式を採用。
 */
export class DiscordPlatform implements Platform {
  name = "discord"
  private client: Client
  private handler?: (msg: IncomingMessage) => void

  constructor(
    private token: string,
    private categoryId?: string,
  ) {
    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
      ],
    })
  }

  async start(): Promise<void> {
    this.client.on("messageCreate", (message) => this.handleMessage(message))
    await this.client.login(this.token)
    console.log(`Discord bot logged in as ${this.client.user?.tag}`)
  }

  stop(): void {
    this.client.destroy()
  }

  onMessage(handler: (msg: IncomingMessage) => void): void {
    this.handler = handler
  }

  async reply(msg: IncomingMessage, text: string): Promise<void> {
    const raw = msg.raw as Message
    const channel = msg.threadId
      ? ((await this.client.channels.fetch(msg.threadId)) as ThreadChannel)
      : (raw.channel as TextChannel)

    // Discord has 2000 char limit per message
    const chunks = splitMessage(text, 2000)
    for (const chunk of chunks) {
      await channel.send(chunk)
    }
  }

  async startThread(msg: IncomingMessage, name: string): Promise<string> {
    const raw = msg.raw as Message
    const thread = await raw.startThread({
      name: name.slice(0, 100),
    })
    return thread.id
  }

  private handleMessage(message: Message): void {
    if (message.author.bot) return
    if (!this.handler) return

    // Check if bot is mentioned or message is in a thread
    const isMention = message.mentions.has(this.client.user!.id)
    const isInThread = message.channel.isThread()

    if (!isMention && !isInThread) return

    // Category filter
    if (this.categoryId) {
      const parentChannel = isInThread
        ? (message.channel as ThreadChannel).parent
        : message.channel
      const categoryMatch =
        parentChannel &&
        "parentId" in parentChannel &&
        parentChannel.parentId === this.categoryId
      if (!categoryMatch) return
    }

    // Resolve repo from channel topic
    const channel = isInThread
      ? (message.channel as ThreadChannel).parent
      : (message.channel as TextChannel)
    const topic = channel && "topic" in channel ? channel.topic : undefined
    const repoHint = parseRepoFromTopic(topic)

    // Remove bot mention from content
    const content = message.content
      .replace(new RegExp(`<@!?${this.client.user!.id}>`, "g"), "")
      .trim()

    const incoming: IncomingMessage = {
      platformName: "discord",
      channelId: message.channel.id,
      threadId: isInThread ? message.channel.id : undefined,
      userId: message.author.id,
      content,
      repoHint,
      raw: message,
    }

    this.handler(incoming)
  }
}

function splitMessage(text: string, maxLength: number): string[] {
  if (text.length <= maxLength) return [text]
  const chunks: string[] = []
  let remaining = text
  while (remaining.length > 0) {
    chunks.push(remaining.slice(0, maxLength))
    remaining = remaining.slice(maxLength)
  }
  return chunks
}
