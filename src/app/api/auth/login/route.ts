import { eq } from "drizzle-orm"
import { NextResponse } from "next/server"
import { z } from "zod"
import { db, t } from "@/db"
import { createSession, errorResponse, HttpError } from "@/lib/auth"
import { hashPassword, verifyPassword } from "@/lib/crypto"
import { loginBlockedFor, recordLoginFailure, recordLoginSuccess } from "@/lib/login-guard"
import { clientIp } from "@/lib/public-api"
import { readJson } from "@/lib/validate"

const Body = z.object({ email: z.string().trim().toLowerCase().max(200), password: z.string().min(1).max(200) })

// Хеш-пустышка: для несуществующей почты считаем scrypt так же долго, как для настоящей,
// иначе по времени ответа видно, какие почты заведены.
let dummyHash: Promise<string> | null = null
const dummy = () => (dummyHash ??= hashPassword("dummy-password-for-timing"))

export async function POST(req: Request) {
  try {
    const { email, password } = await readJson(req, Body)
    const ip = clientIp(req)
    const wait = loginBlockedFor(email, ip)
    if (wait) throw new HttpError(429, `Слишком много неверных попыток — попробуйте через ${wait} мин.`)

    const [user] = await db.select().from(t.users).where(eq(t.users.email, email)).limit(1)
    const valid = await verifyPassword(password, user?.passwordHash ?? (await dummy()))
    if (!user || !user.active || !valid) {
      recordLoginFailure(email, ip)
      throw new HttpError(401, "Неверная почта или пароль")
    }
    recordLoginSuccess(email, ip)
    await createSession(user.id)
    return NextResponse.json({ ok: true })
  } catch (err) {
    return errorResponse(err)
  }
}
