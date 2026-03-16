import { AgentPool } from "./agent-pool.js"
import { Portal } from "./portal.js"
import { Router } from "./router.js"
import type { Agent, Platform } from "./types.js"

async function createAgent(): Promise<Agent> {
  const agentName = process.env.AGENT ?? "aider"
  switch (agentName) {
    case "opencode": {
      const { OpenCodeAgent } = await import("./agents/opencode.js")
      return new OpenCodeAgent()
    }
    case "claude-code": {
      const { ClaudeCodeAgent } = await import("./agents/claude-code.js")
      return new ClaudeCodeAgent()
    }
    default: {
      const { AiderAgent } = await import("./agents/aider.js")
      return new AiderAgent()
    }
  }
}

async function main() {
  const platforms: Platform[] = []

  // Discord Platform (optional)
  if (process.env.DISCORD_TOKEN) {
    const { DiscordPlatform } = await import("./platforms/discord.js")
    platforms.push(new DiscordPlatform(process.env.DISCORD_TOKEN, process.env.DISCORD_CATEGORY_ID))
  }

  // Slack Platform (optional)
  if (process.env.SLACK_BOT_TOKEN && process.env.SLACK_APP_TOKEN) {
    const { SlackPlatform } = await import("./platforms/slack.js")
    platforms.push(new SlackPlatform(process.env.SLACK_BOT_TOKEN, process.env.SLACK_APP_TOKEN))
  }

  const agent = await createAgent()
  console.log(`Agent: ${agent.name}`)
  const agentPool = new AgentPool(agent, {
    reposPath: process.env.HUB_REPOS_PATH ?? "/repos",
    githubToken: process.env.GITHUB_TOKEN,
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
