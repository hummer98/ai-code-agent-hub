import {
  Client,
  GatewayIntentBits,
  type Message,
  type TextChannel,
  type ThreadChannel,
} from "discord.js"
import { afterAll, afterEach, beforeAll, describe, expect, test } from "vitest"

const DISCORD_TEST_BOT_TOKEN = process.env.DISCORD_TEST_BOT_TOKEN
const HUB_BOT_ID = "1439672503810261083"
const TEST_CHANNEL_ID = "1479946719075635274"

const testBot = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
})

const createdThreads: ThreadChannel[] = []
const sentMessages: Message[] = []

describe.skipIf(!DISCORD_TEST_BOT_TOKEN)("Discord E2E", () => {
  beforeAll(async () => {
    if (!DISCORD_TEST_BOT_TOKEN) return
    await testBot.login(DISCORD_TEST_BOT_TOKEN)
    // Wait for the client to be fully ready
    if (!testBot.isReady()) {
      await new Promise<void>((resolve) => testBot.once("ready", () => resolve()))
    }
  })

  afterEach(async () => {
    for (const thread of createdThreads) {
      await thread.delete().catch(() => {})
    }
    createdThreads.length = 0

    for (const msg of sentMessages) {
      await msg.delete().catch(() => {})
    }
    sentMessages.length = 0
  })

  afterAll(async () => {
    testBot.destroy()
  })

  test("@hub mention creates a thread and bot replies", async () => {
    const channel = (await testBot.channels.fetch(TEST_CHANNEL_ID)) as TextChannel
    expect(channel).toBeDefined()

    // Send a mention to the hub bot
    const msg = await channel.send(`<@${HUB_BOT_ID}> hello from e2e test`)
    sentMessages.push(msg)

    // Wait for a thread to be created on that message
    const thread = await waitForThread(testBot, channel.id, 30_000)
    expect(thread).toBeDefined()
    if (thread) createdThreads.push(thread)

    // Wait for the hub bot to reply in the thread
    const reply = await waitForBotReply(testBot, thread?.id ?? "", HUB_BOT_ID, 60_000)
    expect(reply.content.length).toBeGreaterThan(0)
  }, 90_000)

  test("message in existing thread continues conversation", async () => {
    const channel = (await testBot.channels.fetch(TEST_CHANNEL_ID)) as TextChannel

    // First: create a thread via mention
    const msg = await channel.send(`<@${HUB_BOT_ID}> start a session for e2e`)
    sentMessages.push(msg)

    const thread = await waitForThread(testBot, channel.id, 30_000)
    expect(thread).toBeDefined()
    if (thread) createdThreads.push(thread)

    // Wait for initial reply
    await waitForBotReply(testBot, thread?.id ?? "", HUB_BOT_ID, 60_000)

    // Send a follow-up message in the thread (no mention needed)
    if (thread) {
      const followUp = await thread.send("follow-up message from e2e test")
      sentMessages.push(followUp)
    }

    // Wait for a second reply
    const reply = await waitForBotReply(testBot, thread?.id ?? "", HUB_BOT_ID, 60_000)
    expect(reply.content.length).toBeGreaterThan(0)
  }, 90_000)
})

// --- Helpers ---

function waitForThread(
  client: Client,
  parentChannelId: string,
  timeoutMs: number,
): Promise<ThreadChannel | undefined> {
  return new Promise<ThreadChannel | undefined>((resolve) => {
    const timer = setTimeout(() => {
      client.off("threadCreate", handler)
      resolve(undefined)
    }, timeoutMs)

    function handler(thread: ThreadChannel) {
      if (thread.parentId === parentChannelId) {
        clearTimeout(timer)
        client.off("threadCreate", handler)
        resolve(thread)
      }
    }

    client.on("threadCreate", handler)
  })
}

function waitForBotReply(
  client: Client,
  threadId: string,
  botId: string,
  timeoutMs: number,
): Promise<Message> {
  return new Promise<Message>((resolve, reject) => {
    const timer = setTimeout(() => {
      client.off("messageCreate", handler)
      reject(new Error(`Bot reply timeout after ${timeoutMs}ms`))
    }, timeoutMs)

    function handler(msg: Message) {
      if (msg.channel.id === threadId && msg.author.id === botId) {
        clearTimeout(timer)
        client.off("messageCreate", handler)
        resolve(msg)
      }
    }

    client.on("messageCreate", handler)
  })
}
