import { count } from "drizzle-orm"
import { db, t } from "@/db"
import { runMigrations } from "@/db/migrate"
import { connectorsEnabled, startAllChannels, stopAllChannels } from "@/lib/channels/manager"
import { hashPassword } from "@/lib/crypto"

declare global {
  var __domBooted: boolean | undefined
}

async function ensureAdmin() {
  const [{ n }] = await db.select({ n: count() }).from(t.users)
  if (n > 0) return
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase()
  const password = process.env.ADMIN_PASSWORD
  if (!email || !password) {
    console.warn("[boot] Сотрудников нет: задайте ADMIN_EMAIL и ADMIN_PASSWORD, чтобы создать администратора")
    return
  }
  await db.insert(t.users).values({
    email,
    name: process.env.ADMIN_NAME?.trim() || "Администратор",
    role: "admin",
    passwordHash: await hashPassword(password),
  })
  console.log(`[boot] Создан администратор ${email}`)
}

/** Старт сервера: миграции, первый администратор, подключение каналов. */
export async function boot() {
  if (globalThis.__domBooted) return
  globalThis.__domBooted = true
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL не задан — укажите адрес PostgreSQL в .env")
  if (!process.env.APP_SECRET) throw new Error("APP_SECRET не задан — без него нельзя хранить ключи каналов")
  await runMigrations()
  await ensureAdmin()
  if (connectorsEnabled()) {
    const n = await startAllChannels()
    console.log(`[boot] Каналов запущено: ${n}`)
    const shutdown = () => void stopAllChannels()
    process.once("SIGTERM", shutdown)
    process.once("SIGINT", shutdown)
  }
}
