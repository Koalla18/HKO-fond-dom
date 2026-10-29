import { drizzle } from "drizzle-orm/node-postgres"
import { Pool } from "pg"
import * as schema from "./schema"

declare global {
  var __domPool: Pool | undefined
}

// Пул не подключается при импорте: сборка (next build) проходит без базы,
// соединение открывается при первом запросе.
function createPool() {
  return new Pool({ connectionString: process.env.DATABASE_URL, max: Number(process.env.DB_POOL_MAX ?? 10) })
}

// В dev модуль перезагружается при правках — пул держим один на процесс.
export const pool = globalThis.__domPool ?? createPool()
if (process.env.NODE_ENV !== "production") globalThis.__domPool = pool

export const db = drizzle(pool, { schema })
export * as t from "./schema"
