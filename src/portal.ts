import { Hono } from "hono"
import { basicAuth } from "hono/basic-auth"
import { serve } from "@hono/node-server"
import type { AgentPool } from "./agent-pool.js"

/**
 * WebUI リバースプロキシ + リポジトリ一覧。
 * Hono で HTTP サーバーを提供する。
 */
export class Portal {
  private app: Hono
  private server: ReturnType<typeof serve> | undefined

  constructor(
    private agentPool: AgentPool,
    private port = 3000,
  ) {
    this.app = new Hono()
    this.setupMiddleware()
    this.setupRoutes()
  }

  private setupMiddleware(): void {
    const password = process.env.PORTAL_PASSWORD
    if (password) {
      this.app.use(
        "*",
        basicAuth({
          username: "admin",
          password,
        }),
      )
    }
  }

  private setupRoutes(): void {
    this.app.get("/api/repos", (c) => {
      const repos = this.agentPool.listRepos().map((name) => ({
        name,
        port: this.agentPool.getPort(name),
      }))
      return c.json(repos)
    })

    this.app.get("/", (c) => {
      const repos = this.agentPool.listRepos()
      const html = `<!DOCTYPE html>
<html><head><title>AI Code Agent Hub</title></head>
<body>
<h1>AI Code Agent Hub</h1>
<ul>${repos.map((r) => `<li><a href="/repos/${r}/">${r}</a></li>`).join("")}</ul>
</body></html>`
      return c.html(html)
    })
  }

  start(): void {
    this.server = serve({
      fetch: this.app.fetch,
      port: this.port,
    })
    console.log(`Portal listening on http://localhost:${this.port}`)
  }

  stop(): void {
    this.server?.close()
  }
}
