import { asc } from "drizzle-orm"
import { z } from "zod"
import { db, t } from "@/db"
import { api, HttpError } from "@/lib/auth"
import { isChannelKind } from "@/lib/channels/catalog"
import { restartChannel } from "@/lib/channels/manager"
import { cleanConfig, mergeSecrets, publicChannel } from "@/lib/channels/store"
import { randomToken } from "@/lib/crypto"
import { readJson } from "@/lib/validate"

export const GET = api(async () => {
  const rows = await db.select().from(t.channels).orderBy(asc(t.channels.createdAt))
  return { channels: rows.map(publicChannel), appUrl: process.env.APP_URL ?? "" }
})

const Body = z.object({
  kind: z.string(),
  name: z.string().trim().min(1).max(100),
  config: z.record(z.string(), z.unknown()).default({}),
  secrets: z.record(z.string(), z.unknown()).default({}),
  enabled: z.boolean().default(false),
})


export const POST = api(
  async (req) => {
    const body = await readJson(req, Body)
    if (!isChannelKind(body.kind)) throw new HttpError(400, "Неизвестный тип канала")
    const config = cleanConfig(body.kind, body.config)
    // Токен проверки вебхука для Meta и ключ публичного приёма для сайта выдаём сами.
    if (["instagram", "facebook", "whatsapp"].includes(body.kind)) config.verifyToken = randomToken(18)
    if (body.kind === "ok") config.webhookKey = randomToken(18)
    const [row] = await db
      .insert(t.channels)
      .values({ kind: body.kind, name: body.name, config, secrets: mergeSecrets({}, body.secrets), enabled: body.enabled })
      .returning()
    await restartChannel(row.id)
    return { channel: publicChannel(row) }
  },
  { admin: true },
)
