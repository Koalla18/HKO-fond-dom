import { z } from "zod"
import { api, HttpError } from "@/lib/auth"
import { ingestIncoming } from "@/lib/channels/ingest"
import { loadChannel } from "@/lib/channels/store"
import { readJson } from "@/lib/validate"

const Body = z.object({
  channelId: z.string().uuid(),
  externalUserId: z.string().trim().min(1).max(200),
  name: z.string().trim().max(200).optional(),
  email: z.string().trim().max(200).optional(),
  phone: z.string().trim().max(40).optional(),
  subject: z.string().trim().max(300).optional(),
  text: z.string().trim().min(1).max(20000),
})

/**
 * Симулятор входящего: показать, как выглядит заявка из любого канала,
 * без настоящих ключей. Только для администратора; заявки помечены «тест».
 */
export const POST = api(
  async (req) => {
    const body = await readJson(req, Body)
    const loaded = await loadChannel(body.channelId)
    if (!loaded) throw new HttpError(404, "Канал не найден")
    const result = await ingestIncoming(loaded.channel, {
      externalUserId: `test:${body.externalUserId}`,
      replyTo: `test:${body.externalUserId}`,
      name: body.name || "Тестовый посетитель",
      email: body.email,
      phone: body.phone,
      subject: body.subject,
      text: body.text,
      externalMessageId: `test:${crypto.randomUUID()}`,
      meta: { simulated: true },
    })
    return { requestId: result?.requestId ?? null }
  },
  { admin: true },
)
