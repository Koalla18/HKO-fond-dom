import { sql } from "drizzle-orm"
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { db, pool } from "@/db"
import { runMigrations } from "@/db/migrate"
import { loadLlmConfig } from "@/lib/agent/llm"

/** Длинные ключи (Timeweb — JWT на тысячи символов) сохраняются целиком. */

vi.mock("@/lib/auth", async (orig) => {
  const mod = await orig<typeof import("@/lib/auth")>()
  return { ...mod, api: (fn: (...a: unknown[]) => unknown) => async (req: Request, ctx: unknown) => Response.json(await fn(req, ctx, { id: "x", role: "admin", name: "А" })) }
})
const { PATCH } = await import("@/app/api/settings/route")

beforeAll(async () => {
  process.env.APP_SECRET ??= Buffer.alloc(32, 7).toString("base64")
  await runMigrations()
})
afterAll(async () => {
  await pool.end()
})
beforeEach(async () => {
  await db.execute(sql`delete from settings where key in ('ai', 'aiKey')`)
})

describe("ключ ассистента", () => {
  it("длинный токен Timeweb с переносами строк и «Bearer» сохраняется как есть", async () => {
    const token = "eyJhbGciOiJSUzUxMiJ9." + "a".repeat(1800) + "." + "b".repeat(700)
    const pasted = `Bearer ${token.slice(0, 900)}\n${token.slice(900)}\n`
    const res = await PATCH(
      new Request("http://x/api/settings", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ai: { provider: "timeweb", baseUrl: "https://agent.timeweb.cloud/api/v1/cloud-ai/agents/f8e112cd/v1" }, aiKey: pasted }),
      }),
      {} as never,
    )
    expect(res.status).toBe(200)
    const cfg = await loadLlmConfig()
    expect(cfg?.apiKey).toBe(token)
    expect(cfg?.redact).toBe(false)
  })
})
