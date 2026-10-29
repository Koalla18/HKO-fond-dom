import { eq } from "drizzle-orm"
import { z } from "zod"
import { db, t } from "@/db"
import { api, HttpError } from "@/lib/auth"
import { hashPassword } from "@/lib/crypto"
import { readJson } from "@/lib/validate"

type Ctx = { params: Promise<{ id: string }> }

const Body = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  role: z.enum(["admin", "agent"]).optional(),
  active: z.boolean().optional(),
  password: z.string().min(8, "минимум 8 символов").optional(),
})

export const PATCH = api(
  async (req, ctx: Ctx, me) => {
    const { id } = await ctx.params
    const body = await readJson(req, Body)
    if (id === me.id && (body.active === false || body.role === "agent")) throw new HttpError(400, "Нельзя отключить или понизить себя")
    await db
      .update(t.users)
      .set({
        ...(body.name ? { name: body.name } : {}),
        ...(body.role ? { role: body.role } : {}),
        ...(body.active !== undefined ? { active: body.active } : {}),
        ...(body.password ? { passwordHash: await hashPassword(body.password) } : {}),
      })
      .where(eq(t.users.id, id))
    if (body.active === false || body.password) await db.delete(t.sessions).where(eq(t.sessions.userId, id))
    return { ok: true }
  },
  { admin: true },
)
