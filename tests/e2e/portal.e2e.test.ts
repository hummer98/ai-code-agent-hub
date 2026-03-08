import { describe, expect, test } from "vitest"

const PORTAL_URL = process.env.PORTAL_URL ?? "http://172.25.76.16:3000"
const PORTAL_PASSWORD = process.env.PORTAL_PASSWORD

describe.skipIf(!process.env.PORTAL_URL && !process.env.CI)("Portal E2E", () => {
  describe("without auth", { skip: !!PORTAL_PASSWORD }, () => {
    test("GET /api/repos returns JSON array", async () => {
      const res = await fetch(`${PORTAL_URL}/api/repos`)
      expect(res.status).toBe(200)
      expect(res.headers.get("content-type")).toContain("application/json")
      const repos = await res.json()
      expect(Array.isArray(repos)).toBe(true)
    })

    test("GET / returns HTML", async () => {
      const res = await fetch(PORTAL_URL)
      expect(res.status).toBe(200)
      expect(res.headers.get("content-type")).toContain("text/html")
      const html = await res.text()
      expect(html).toContain("AI Code Agent Hub")
    })
  })

  describe("with auth", { skip: !PORTAL_PASSWORD }, () => {
    test("GET /api/repos without credentials returns 401", async () => {
      const res = await fetch(`${PORTAL_URL}/api/repos`)
      expect(res.status).toBe(401)
    })

    test("GET /api/repos with valid Basic Auth returns 200", async () => {
      const credentials = btoa(`admin:${PORTAL_PASSWORD}`)
      const res = await fetch(`${PORTAL_URL}/api/repos`, {
        headers: { Authorization: `Basic ${credentials}` },
      })
      expect(res.status).toBe(200)
      const repos = await res.json()
      expect(Array.isArray(repos)).toBe(true)
    })

    test("GET / with valid Basic Auth returns HTML", async () => {
      const credentials = btoa(`admin:${PORTAL_PASSWORD}`)
      const res = await fetch(PORTAL_URL, {
        headers: { Authorization: `Basic ${credentials}` },
      })
      expect(res.status).toBe(200)
      expect(res.headers.get("content-type")).toContain("text/html")
      const html = await res.text()
      expect(html).toContain("AI Code Agent Hub")
    })

    test("GET /api/repos with wrong password returns 401", async () => {
      const credentials = btoa("admin:wrong-password")
      const res = await fetch(`${PORTAL_URL}/api/repos`, {
        headers: { Authorization: `Basic ${credentials}` },
      })
      expect(res.status).toBe(401)
    })
  })
})
