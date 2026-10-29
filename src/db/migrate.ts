import path from "node:path"
import { migrate } from "drizzle-orm/node-postgres/migrator"
import { db } from "./index"

/** Применяет SQL-миграции из ./drizzle. Вызывается при старте сервера и командой npm run db:migrate. */
export async function runMigrations() {
  await migrate(db, { migrationsFolder: path.join(process.cwd(), "drizzle") })
}
