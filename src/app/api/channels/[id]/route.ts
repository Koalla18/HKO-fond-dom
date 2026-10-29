import { count, eq } from "drizzle-orm"
import { z } from "zod"
import { db, t } from "@/db"
import { api, HttpError } from "@/lib/auth"
import type { ChannelKind } from "@/lib/channels/catalog"
import { restartChannel, stopChannel } from "@/lib/channels/manager"
import { cleanConfig, loadChannel, mergeSecrets, publicChannel } from "@/lib/channels/store"
import { readJson } from "@/lib/validate"

type Ctx = { params: Promise<{ id: string }> }

const Body = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  enabled: z.boolean().optional(),
  config: z.record(z.string(), z.unknown()).optional(),
  secrets: z.record(z.string(), z.unknown()).optional(),
})

export const PATCH = api(
  async (req, ctx: Ctx) => {
    const { id } = await ctx.params
    const loaded = await loadChannel(id)
    if (!loaded) throw new HttpError(404, "Канал не найден")
    const body = await readJson(req, Body)
    const kind = loaded.channel.kind as ChannelKind
    // Служебные ключи (_курсоры, verifyToken) сохраняем, пользовательские поля — из формы.
    const kept = Object.fromEntries(Object.entries(loaded.config).filter(([k]) => k.startsWith("_") || k === "verifyToken" || k === "webhookKey"))
    const config = body.config ? { ...kept, ...cleanConfig(kind, { ...loaded.config, ...body.config }) } : loaded.config
    const [row] = await db
      .update(t.channels)
      .set({
        ...(body.name ? { name: body.name } : {}),
        ...(body.enabled !== undefined ? { enabled: body.enabled } : {}),
        config,
        ...(body.secrets ? { secrets: mergeSecrets(loaded.secrets, body.secrets) } : {}),
      })
      .where(eq(t.channels.id, id))
      .returning()
    await restartChannel(id)
    return { channel: publicChannel(row) }
  },
  { admin: true },
)

export const DELETE = api(
  async (_req, ctx: Ctx) => {
    const { id } = await ctx.params
    const [{ n }] = await db.select({ n: count() }).from(t.requests).where(eq(t.requests.channelId, id))
    if (n > 0) throw new HttpError(409, `В канале ${n} заявок — его можно только выключить, чтобы не потерять историю`)
    await stopChannel(id)
    await db.delete(t.channels).where(eq(t.channels.id, id))
    return { ok: true }
  },
  { admin: true },
)
