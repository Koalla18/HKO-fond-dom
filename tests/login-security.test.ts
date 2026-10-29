import { sql } from "drizzle-orm"
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { db, pool, t } from "@/db"
import { runMigrations } from "@/db/migrate"
import { hashPassword } from "@/lib/crypto"
import { resetLoginGuard } from "@/lib/login-guard"

/** Защита входа от подбора: подмена заголовков не помогает, почты не угадываются по времени. */

vi.mock("next/headers", () => ({ cookies: async () => ({ set: () => {}, get: () => undefined, delete: () => {} }) }))
const { POST: login } = await import("@/app/api/auth/login/route")

const attempt = (email: string, password: string, headers: Record<string, string> = {}) =>
  login(new Request("http://x/api/auth/login", { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify({ email, password }) }))

beforeAll(async () => {
  await runMigrations()
})
afterAll(async () => {
  await pool.end()
})
beforeEach(async () => {
  resetLoginGuard()
  delete process.env.TRUST_PROXY
  await db.execute(sql`truncate sessions, users restart identity cascade`)
  await db.insert(t.users).values({ email: "maria@dom.local", name: "Мария", passwordHash: await hashPassword("correct-horse-battery") })
})

describe("вход", () => {
  it("верный пароль пускает, неверный — нет", async () => {
    expect((await attempt("maria@dom.local", "correct-horse-battery")).status).toBe(200)
    expect((await attempt("maria@dom.local", "nope")).status).toBe(401)
  })

  it("подбор пароля одной учётной записи останавливается, даже если менять X-Forwarded-For", async () => {
    const codes = []
    for (let i = 0; i < 7; i++) codes.push((await attempt("maria@dom.local", `guess-${i}`, { "x-forwarded-for": `10.0.${i}.1` })).status)
    expect(codes).toEqual([401, 401, 401, 401, 401, 429, 429])
    // Даже верный пароль не проходит, пока учётная запись закрыта — подбор не узнает, что угадал.
    expect((await attempt("maria@dom.local", "correct-horse-battery")).status).toBe(429)
  })

  it("чужой подбор не блокирует остальных сотрудников", async () => {
    await db.insert(t.users).values({ email: "olga@dom.local", name: "Ольга", passwordHash: await hashPassword("another-good-pass") })
    for (let i = 0; i < 6; i++) await attempt("maria@dom.local", `guess-${i}`)
    expect((await attempt("olga@dom.local", "another-good-pass")).status).toBe(200)
  })

  it("за своим прокси считается и адрес: перебор разных почт с одного адреса закрывается", async () => {
    process.env.TRUST_PROXY = "1"
    const codes = []
    for (let i = 0; i < 22; i++) codes.push((await attempt(`user${i}@dom.local`, "x", { "x-forwarded-for": "203.0.113.5" })).status)
    expect(codes.slice(0, 20).every((c) => c === 401)).toBe(true)
    expect(codes.slice(20)).toEqual([429, 429])
  })

  it("несуществующая почта отвечает так же и так же долго", async () => {
    const time = async (email: string) => {
      const start = performance.now()
      const res = await attempt(email, "wrong-password")
      return { ms: performance.now() - start, status: res.status, body: await res.json() }
    }
    await time("nobody@dom.local") // прогрев хеша-пустышки
    const real = await time("maria@dom.local")
    const fake = await time("nobody@dom.local")
    expect(fake.status).toBe(real.status)
    expect(fake.body).toEqual(real.body)
    expect(Math.abs(real.ms - fake.ms)).toBeLessThan(Math.max(real.ms, fake.ms) * 0.5)
  })

  it("слишком длинный пароль отклоняется сразу", async () => {
    expect((await attempt("maria@dom.local", "x".repeat(10_000))).status).toBe(400)
  })
})
