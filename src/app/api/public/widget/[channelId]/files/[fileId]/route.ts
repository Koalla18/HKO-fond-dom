import { and, eq, inArray, sql } from "drizzle-orm"
import { db, t } from "@/db"
import { loadChannel } from "@/lib/channels/store"
import { readStoredFile } from "@/lib/storage"

type Ctx = { params: Promise<{ channelId: string; fileId: string }> }
const VISITOR = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const UUID = /^[0-9a-f-]{36}$/
const INLINE = /^(image\/(png|jpe?g|gif|webp)|application\/pdf)/

/**
 * Файл, который фонд отправил посетителю в чат на сайте. Отдаётся только этому посетителю
 * и только если файл действительно был в ответе ему — остальные файлы кабинета закрыты.
 */
export async function GET(req: Request, ctx: Ctx) {
  const { channelId, fileId } = await ctx.params
  const visitorId = new URL(req.url).searchParams.get("visitorId") ?? ""
  const notFound = () => new Response("not found", { status: 404 })
  if (!UUID.test(channelId) || !UUID.test(fileId) || !VISITOR.test(visitorId)) return notFound()
  const loaded = await loadChannel(channelId)
  if (!loaded || loaded.channel.kind !== "widget" || !loaded.channel.enabled) return notFound()

  const [identity] = await db
    .select({ contactId: t.contactIdentities.contactId })
    .from(t.contactIdentities)
    .where(and(eq(t.contactIdentities.channelId, channelId), eq(t.contactIdentities.externalId, `visitor:${visitorId}`)))
    .limit(1)
  if (!identity) return notFound()
  const requestIds = db
    .select({ id: t.requests.id })
    .from(t.requests)
    .where(and(eq(t.requests.channelId, channelId), eq(t.requests.contactId, identity.contactId)))
  const [sent] = await db
    .select({ id: t.messages.id })
    .from(t.messages)
    .where(
      and(
        inArray(t.messages.requestId, requestIds),
        eq(t.messages.direction, "out"),
        sql`${t.messages.attachments} @> ${JSON.stringify([{ url: `/api/files/${fileId}` }])}::jsonb`,
      ),
    )
    .limit(1)
  if (!sent) return notFound()

  const file = await readStoredFile(fileId)
  if (!file) return notFound()
  const inline = INLINE.test(file.mime)
  return new Response(new Uint8Array(file.data), {
    headers: {
      "content-type": inline ? file.mime : "application/octet-stream",
      "content-disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(file.name)}`,
      "x-content-type-options": "nosniff",
      "cache-control": "private, max-age=86400",
      "access-control-allow-origin": "*",
    },
  })
}
