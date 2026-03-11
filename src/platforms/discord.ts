import {
  ChannelType,
  Client,
  GatewayIntentBits,
  type GuildChannel,
  type Message,
  type TextChannel,
  type ThreadChannel,
} from "discord.js"
import type { IncomingMessage, Platform } from "../types.js"
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
    this.client.on("channelCreate", (channel) => this.handleChannelCreate(channel))
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

    // 空メッセージは Discord API がエラーを返すため送信しない
    if (!text.trim()) return

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
    const botUser = this.client.user
    if (!botUser) return
    if (message.author.id === botUser.id) return
    if (!this.handler) return

    // Check if bot is mentioned or message is in a thread
    const isMention = message.mentions.has(botUser.id)
    const isInThread = message.channel.isThread()

    if (!isMention && !isInThread) return

    // Category filter
    if (this.categoryId) {
      const parentChannel = isInThread ? (message.channel as ThreadChannel).parent : message.channel
      const categoryMatch =
        parentChannel && "parentId" in parentChannel && parentChannel.parentId === this.categoryId
      if (!categoryMatch) return
    }

    // Resolve repo from channel topic
    const channel = isInThread
      ? (message.channel as ThreadChannel).parent
      : (message.channel as TextChannel)
    const topic = channel && "topic" in channel ? channel.topic : undefined
    const repoHint = parseRepoFromTopic(topic)

    // Remove bot mention from content
    const content = message.content.replace(new RegExp(`<@!?${botUser.id}>`, "g"), "").trim()

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

  private async handleChannelCreate(channel: GuildChannel): Promise<void> {
    if (channel.type !== ChannelType.GuildText) return

    if (this.categoryId && channel.parentId !== this.categoryId) return

    const textChannel = channel as TextChannel
    const repoHint = parseRepoFromTopic(textChannel.topic)

    if (!repoHint) {
      const botUser = this.client.user
      await textChannel.send(
        [
          "**AI Code Agent Hub** へようこそ!",
          "",
          "このチャンネルで AI エージェントを使うには:",
          "1. チャンネルトピックに `repo:owner/name` を設定",
          `2. <@${botUser?.id}> にメンションして会話を開始`,
          "",
          `例: トピックに \`repo:myorg/my-app\` と設定 → \`@${botUser?.username} バグを修正して\``,
        ].join("\n"),
      )
    }
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
