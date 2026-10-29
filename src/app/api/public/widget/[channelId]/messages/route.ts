import { and, asc, eq, gt, inArray } from "drizzle-orm"
import { db, t } from "@/db"
import { ingestIncoming, normalizeEmail } from "@/lib/channels/ingest"
import { loadChannel } from "@/lib/channels/store"
import { clientIp, CORS, json, rateLimited } from "@/lib/public-api"

type Ctx = { params: Promise<{ channelId: string }> }
const VISITOR = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

async function widgetChannel(ctx: Ctx) {
  const { channelId } = await ctx.params
  const loaded = /^[0-9a-f-]{36}$/.test(channelId) ? await loadChannel(channelId) : null
  return loaded && loaded.channel.kind === "widget" && loaded.channel.enabled ? loaded : null
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS })
}

/** Переписка посетителя: его сообщения и ответы фонда (заметки сотрудников не отдаются). */
export async function GET(req: Request, ctx: Ctx) {
  const loaded = await widgetChannel(ctx)
  if (!loaded) return json({ error: "not found" }, 404)
  const url = new URL(req.url)
  const visitorId = url.searchParams.get("visitorId") ?? ""
  if (!VISITOR.test(visitorId)) return json({ messages: [] })
  const after = url.searchParams.get("after")
  const base = (process.env.APP_URL || url.origin).replace(/\/$/, "")
  const [identity] = await db
    .select({ contactId: t.contactIdentities.contactId })
    .from(t.contactIdentities)
    .where(and(eq(t.contactIdentities.channelId, loaded.channel.id), eq(t.contactIdentities.externalId, `visitor:${visitorId}`)))
    .limit(1)
  if (!identity) return json({ messages: [] })
  const requestIds = db
    .select({ id: t.requests.id })
    .from(t.requests)
    .where(and(eq(t.requests.channelId, loaded.channel.id), eq(t.requests.contactId, identity.contactId)))
  const rows = await db
    .select({ id: t.messages.id, direction: t.messages.direction, authorType: t.messages.authorType, text: t.messages.text, createdAt: t.messages.createdAt, meta: t.messages.meta, attachments: t.messages.attachments })
    .from(t.messages)
    .where(
      and(
        inArray(t.messages.requestId, requestIds),
        inArray(t.messages.direction, ["in", "out"]),
        after && !Number.isNaN(Date.parse(after)) ? gt(t.messages.createdAt, new Date(after)) : undefined,
      ),
    )
    .orderBy(asc(t.messages.createdAt))
    .limit(100)
  return json({ messages: rows.map((m) => {
      const quote = (m.meta.replyTo as { text?: string } | undefined)?.text
      // Файлы фонда — по публичной ссылке для этого посетителя (файлы кабинета закрыты входом).
      const files =
        m.direction === "out"
          ? m.attachments
              .filter((f) => f.url)
              .map((f) => ({
                name: f.name,
                image: /^image\/(png|jpe?g|gif|webp)$/.test(f.mime),
                url: `${base}/api/public/widget/${loaded.channel.id}/files/${f.url.split("/").pop()}?visitorId=${visitorId}`,
              }))
          : []
      return { id: m.id, from: m.direction === "in" ? "visitor" : "fund", text: m.text, at: m.createdAt, ...(quote ? { quote } : {}), ...(files.length ? { files } : {}) }
    }) })
}

/** Сообщение посетителя с сайта. */
export async function POST(req: Request, ctx: Ctx) {
  const loaded = await widgetChannel(ctx)
  if (!loaded) return json({ error: "not found" }, 404)
  const body = (await req.json().catch(() => ({}))) as { visitorId?: string; text?: string; name?: string; email?: string }
  const visitorId = String(body.visitorId ?? "")
  const text = String(body.text ?? "").trim().slice(0, 4000)
  if (!VISITOR.test(visitorId)) return json({ error: "bad visitor" }, 400)
  if (!text) return json({ error: "Пустое сообщение" }, 400)
  if (rateLimited(`widget:${clientIp(req)}`, 30, 60_000)) return json({ error: "Слишком часто, подождите минуту" }, 429)
  await ingestIncoming(loaded.channel, {
    externalUserId: `visitor:${visitorId}`,
    replyTo: `visitor:${visitorId}`,
    name: String(body.name ?? "").trim().slice(0, 100) || undefined,
    email: normalizeEmail(String(body.email ?? "")) ?? undefined,
    text,
    externalMessageId: undefined,
    meta: { page: req.headers.get("referer") ?? null },
  })
  return json({ ok: true })
}
