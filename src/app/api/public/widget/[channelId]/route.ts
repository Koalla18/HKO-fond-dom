import { loadChannel } from "@/lib/channels/store"
import { CORS, json } from "@/lib/public-api"
import { getSetting } from "@/lib/settings"

type Ctx = { params: Promise<{ channelId: string }> }

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS })
}

/** Настройки виджета для сайта: приветствие, цвет, название фонда. */
export async function GET(_req: Request, ctx: Ctx) {
  const { channelId } = await ctx.params
  const loaded = /^[0-9a-f-]{36}$/.test(channelId) ? await loadChannel(channelId) : null
  if (!loaded || loaded.channel.kind !== "widget" || !loaded.channel.enabled) return json({ error: "not found" }, 404)
  const org = await getSetting("org")
  return json({
    title: org.name,
    greeting: String(loaded.config.greeting ?? "Здравствуйте! Напишите, чем мы можем помочь."),
    site: org.site,
    accent: /^#[0-9a-f]{3,8}$/i.test(String(loaded.config.accent)) ? loaded.config.accent : "#0a7d9e",
  })
}
