import { AgentPool } from "./agent-pool.js"
import { Router } from "./router.js"
import { Portal } from "./portal.js"
import { OpenCodeAgent } from "./agents/opencode.js"
import type { Platform } from "./types.js"

async function main() {
  const platforms: Platform[] = []

  // Discord Platform (optional)
  if (process.env.DISCORD_TOKEN) {
    const { DiscordPlatform } = await import("./platforms/discord.js")
    platforms.push(
      new DiscordPlatform(
        process.env.DISCORD_TOKEN,
        process.env.DISCORD_CATEGORY_ID,
      ),
    )
  }

  // Slack Platform (optional)
  if (process.env.SLACK_BOT_TOKEN && process.env.SLACK_APP_TOKEN) {
    const { SlackPlatform } = await import("./platforms/slack.js")
    platforms.push(
      new SlackPlatform(
        process.env.SLACK_BOT_TOKEN,
        process.env.SLACK_APP_TOKEN,
      ),
    )
  }

  const agent = new OpenCodeAgent()
  const agentPool = new AgentPool(agent, {
    reposPath: process.env.HUB_REPOS_PATH ?? "/repos",
  })

  const router = new Router(platforms, agentPool)
  const portal = new Portal(agentPool, Number(process.env.PORT) || 3000)

  // Start all components
  agentPool.start()
  router.start()

  for (const platform of platforms) {
    await platform.start()
    console.log(`Platform started: ${platform.name}`)
  }

  portal.start()

  // Graceful shutdown
  const shutdown = () => {
    console.log("Shutting down...")
    portal.stop()
    for (const platform of platforms) {
      platform.stop()
    }
    agentPool.stopAll()
    process.exit(0)
  }

  process.on("SIGINT", shutdown)
  process.on("SIGTERM", shutdown)
}

main().catch((err) => {
  console.error("Fatal error:", err)
  process.exit(1)
})
