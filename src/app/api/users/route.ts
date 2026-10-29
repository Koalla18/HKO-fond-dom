import { asc } from "drizzle-orm"
import { z } from "zod"
import { db, t } from "@/db"
import { isUniqueViolation } from "@/db/errors"
import { api, HttpError } from "@/lib/auth"
import { hashPassword } from "@/lib/crypto"
import { readJson } from "@/lib/validate"

export const GET = api(async () => ({
  users: await db
    .select({ id: t.users.id, email: t.users.email, name: t.users.name, role: t.users.role, active: t.users.active })
    .from(t.users)
    .orderBy(asc(t.users.name)),
}))

const Body = z.object({
  email: z.string().trim().toLowerCase().email("неверный адрес"),
  name: z.string().trim().min(1).max(100),
  role: z.enum(["admin", "agent"]).default("agent"),
  password: z.string().min(8, "минимум 8 символов"),
})

export const POST = api(
  async (req) => {
    const body = await readJson(req, Body)
    try {
      const [user] = await db
        .insert(t.users)
        .values({ email: body.email, name: body.name, role: body.role, passwordHash: await hashPassword(body.password) })
        .returning({ id: t.users.id })
      return { id: user.id }
    } catch (err) {
      if (isUniqueViolation(err)) throw new HttpError(409, "Сотрудник с такой почтой уже есть")
      throw err
    }
  },
  { admin: true },
)
