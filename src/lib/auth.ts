import { and, eq, gt } from "drizzle-orm"
import { cookies } from "next/headers"
import { NextResponse } from "next/server"
import { db, t } from "@/db"
import { randomToken, sha256 } from "./crypto"

export const SESSION_COOKIE = "dom_session"
const SESSION_DAYS = 30

export type SessionUser = Pick<t.User, "id" | "email" | "name" | "role">

export async function createSession(userId: string) {
  const token = randomToken()
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 3600 * 1000)
  await db.insert(t.sessions).values({ id: sha256(token), userId, expiresAt })
  const store = await cookies()
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: (process.env.APP_URL ?? "").startsWith("https://"),
    path: "/",
    expires: expiresAt,
  })
}

export async function destroySession() {
  const store = await cookies()
  const token = store.get(SESSION_COOKIE)?.value
  if (token) await db.delete(t.sessions).where(eq(t.sessions.id, sha256(token)))
  store.delete(SESSION_COOKIE)
}

export async function getSessionUser(): Promise<SessionUser | null> {
  const store = await cookies()
  const token = store.get(SESSION_COOKIE)?.value
  if (!token) return null
  const [row] = await db
    .select({ id: t.users.id, email: t.users.email, name: t.users.name, role: t.users.role, active: t.users.active })
    .from(t.sessions)
    .innerJoin(t.users, eq(t.users.id, t.sessions.userId))
    .where(and(eq(t.sessions.id, sha256(token)), gt(t.sessions.expiresAt, new Date())))
    .limit(1)
  if (!row || !row.active) return null
  return { id: row.id, email: row.email, name: row.name, role: row.role }
}

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
  }
}

/** Обёртка для API-ручек: проверяет сессию, превращает HttpError в JSON-ответ. */
export function api<C>(
  handler: (req: Request, ctx: C, user: SessionUser) => Promise<Response | unknown>,
  opts: { admin?: boolean } = {},
) {
  return async (req: Request, ctx: C) => {
    try {
      const user = await getSessionUser()
      if (!user) throw new HttpError(401, "Нужно войти")
      if (opts.admin && user.role !== "admin") throw new HttpError(403, "Только для администратора")
      const result = await handler(req, ctx, user)
      return result instanceof Response ? result : NextResponse.json(result ?? { ok: true })
    } catch (err) {
      return errorResponse(err)
    }
  }
}

export function errorResponse(err: unknown) {
  if (err instanceof HttpError) return NextResponse.json({ error: err.message }, { status: err.status })
  console.error("[api]", err)
  return NextResponse.json({ error: "Внутренняя ошибка" }, { status: 500 })
}
