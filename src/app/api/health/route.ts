import { sql } from "drizzle-orm"
import { db } from "@/db"

export const dynamic = "force-dynamic"

/** Проверка живости для Docker и мониторинга: сервер отвечает и база доступна. */
export async function GET() {
  try {
    await db.execute(sql`select 1`)
    return Response.json({ ok: true })
  } catch {
    return Response.json({ ok: false }, { status: 503 })
  }
}
