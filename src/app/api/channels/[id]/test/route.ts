import { api, HttpError } from "@/lib/auth"
import type { ChannelKind } from "@/lib/channels/catalog"
import { makeContext } from "@/lib/channels/manager"
import { getAdapter } from "@/lib/channels/registry"
import { loadChannel } from "@/lib/channels/store"

type Ctx = { params: Promise<{ id: string }> }

/** «Проверить подключение»: вход в почту, getMe бота, доступ к сообществу. */
export const POST = api(
  async (_req, ctx: Ctx) => {
    const { id } = await ctx.params
    const loaded = await loadChannel(id)
    if (!loaded) throw new HttpError(404, "Канал не найден")
    const adapter = getAdapter(loaded.channel.kind as ChannelKind)
    if (!adapter.test) return { ok: true, message: "Проверять нечего — канал работает без внешних ключей" }
    try {
      const message = await adapter.test(makeContext(loaded.channel, new AbortController().signal))
      return { ok: true, message }
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : String(err) }
    }
  },
  { admin: true },
)
