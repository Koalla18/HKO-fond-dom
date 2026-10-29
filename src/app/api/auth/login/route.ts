import { eq } from "drizzle-orm"
import { NextResponse } from "next/server"
import { z } from "zod"
import { db, t } from "@/db"
import { createSession, errorResponse, HttpError } from "@/lib/auth"
import { verifyPassword } from "@/lib/crypto"
import { readJson } from "@/lib/validate"

const Body = z.object({ email: z.string().trim().toLowerCase(), password: z.string().min(1) })

// Простая защита от перебора: не больше 10 попыток за 10 минут с одного адреса.
const attempts = new Map<string, { n: number; until: number }>()

export async function POST(req: Request) {
  try {
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local"
    const now = Date.now()
    const slot = attempts.get(ip)
    if (slot && slot.until > now && slot.n >= 10) throw new HttpError(429, "Слишком много попыток — подождите 10 минут")
    const { email, password } = await readJson(req, Body)
    const [user] = await db.select().from(t.users).where(eq(t.users.email, email)).limit(1)
    const ok = user?.active && (await verifyPassword(password, user.passwordHash))
    if (!ok) {
      attempts.set(ip, { n: (slot && slot.until > now ? slot.n : 0) + 1, until: now + 10 * 60_000 })
      throw new HttpError(401, "Неверная почта или пароль")
    }
    attempts.delete(ip)
    await createSession(user.id)
    return NextResponse.json({ ok: true })
  } catch (err) {
    return errorResponse(err)
  }
}
