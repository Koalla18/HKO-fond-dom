import type { ChannelKind } from "@/lib/channels/catalog"
import { makeContext } from "@/lib/channels/manager"
import { getAdapter } from "@/lib/channels/registry"
import { loadChannel } from "@/lib/channels/store"

type Ctx = { params: Promise<{ channelId: string }> }

/** Единый адрес вебхуков: /api/webhooks/<id канала> — Telegram, Meta, WhatsApp, MAX. */
async function handle(req: Request, ctx: Ctx) {
  const { channelId } = await ctx.params
  if (!/^[0-9a-f-]{36}$/.test(channelId)) return new Response("not found", { status: 404 })
  const loaded = await loadChannel(channelId)
  if (!loaded || !loaded.channel.enabled) return new Response("not found", { status: 404 })
  const adapter = getAdapter(loaded.channel.kind as ChannelKind)
  if (!adapter.webhook) return new Response("not found", { status: 404 })
  const rawBody = req.method === "POST" ? await req.text() : ""
  if (rawBody.length > 5 * 1024 * 1024) return new Response("too large", { status: 413 })
  try {
    return await adapter.webhook(req, makeContext(loaded.channel, new AbortController().signal), rawBody)
  } catch (err) {
    console.error(`[webhook ${loaded.channel.kind}]`, err)
    // 200, чтобы площадка не заваливала повторами из-за одной битой записи; ошибку видно в логе.
    return new Response("error logged")
  }
}

export const GET = handle
export const POST = handle
