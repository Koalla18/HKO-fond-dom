import { and, count, desc, eq, ilike, inArray, isNull, or, sql, type SQL } from "drizzle-orm"
import { z } from "zod"
import { db, t } from "@/db"
import { api, HttpError } from "@/lib/auth"
import { ingestIncoming } from "@/lib/channels/ingest"
import { readJson } from "@/lib/validate"
import { publish } from "@/lib/events"

/** Список заявок для входящих + счётчики для боковой панели. */
export const GET = api(async (req, _ctx, user) => {
  const url = new URL(req.url)
  const view = url.searchParams.get("view") ?? "active" // active | mine | unassigned | ai | resolved | spam | all
  const channelId = url.searchParams.get("channel")
  const q = url.searchParams.get("q")?.trim()
  const limit = Math.min(Number(url.searchParams.get("limit") ?? 100), 300)

  const where: SQL[] = []
  if (view === "active") where.push(inArray(t.requests.status, ["new", "open", "waiting"]))
  if (view === "mine") where.push(eq(t.requests.assigneeId, user.id), inArray(t.requests.status, ["new", "open", "waiting"]))
  if (view === "unassigned") where.push(isNull(t.requests.assigneeId), inArray(t.requests.status, ["new", "open", "waiting"]))
  if (view === "ai") where.push(eq(t.requests.aiHandling, true), inArray(t.requests.status, ["new", "open", "waiting"]))
  if (view === "resolved") where.push(eq(t.requests.status, "resolved"))
  if (view === "spam") where.push(eq(t.requests.status, "spam"))
  if (channelId) where.push(eq(t.requests.channelId, channelId))
  if (q) {
    const like = `%${q.replace(/[%_]/g, "\\$&")}%`
    const byNumber = /^#?\d+$/.test(q) ? [eq(t.requests.number, Number(q.replace("#", "")))] : []
    where.push(
      or(
        ilike(t.contacts.name, like),
        ilike(t.contacts.email, like),
        ilike(t.contacts.phone, like),
        ilike(t.requests.subject, like),
        ilike(t.requests.lastMessagePreview, like),
        ...byNumber,
      )!,
    )
  }

  const items = await db
    .select({
      id: t.requests.id,
      number: t.requests.number,
      status: t.requests.status,
      priority: t.requests.priority,
      category: t.requests.category,
      subject: t.requests.subject,
      summary: t.requests.summary,
      aiHandling: t.requests.aiHandling,
      unread: t.requests.unread,
      lastMessageAt: t.requests.lastMessageAt,
      lastMessagePreview: t.requests.lastMessagePreview,
      lastMessageDirection: t.requests.lastMessageDirection,
      createdAt: t.requests.createdAt,
      contact: { id: t.contacts.id, name: t.contacts.name, avatarUrl: t.contacts.avatarUrl },
      channel: { id: t.channels.id, kind: t.channels.kind, name: t.channels.name },
      assignee: { id: t.users.id, name: t.users.name },
    })
    .from(t.requests)
    .innerJoin(t.contacts, eq(t.contacts.id, t.requests.contactId))
    .innerJoin(t.channels, eq(t.channels.id, t.requests.channelId))
    .leftJoin(t.users, eq(t.users.id, t.requests.assigneeId))
    .where(where.length ? and(...where) : undefined)
    .orderBy(desc(t.requests.lastMessageAt))
    .limit(limit)

  const active = ["new", "open", "waiting"] as const
  const [counts] = await db
    .select({
      active: sql<number>`count(*) filter (where ${inArray(t.requests.status, [...active])})`.mapWith(Number),
      fresh: sql<number>`count(*) filter (where ${t.requests.status} = 'new')`.mapWith(Number),
      mine: sql<number>`count(*) filter (where ${t.requests.assigneeId} = ${user.id} and ${inArray(t.requests.status, [...active])})`.mapWith(Number),
      unassigned: sql<number>`count(*) filter (where ${t.requests.assigneeId} is null and ${inArray(t.requests.status, [...active])})`.mapWith(Number),
      ai: sql<number>`count(*) filter (where ${t.requests.aiHandling} and ${inArray(t.requests.status, [...active])})`.mapWith(Number),
      unread: sql<number>`coalesce(sum(${t.requests.unread}) filter (where ${inArray(t.requests.status, [...active])}), 0)`.mapWith(Number),
    })
    .from(t.requests)
  const byChannel = await db
    .select({ channelId: t.requests.channelId, n: count() })
    .from(t.requests)
    .where(inArray(t.requests.status, [...active]))
    .groupBy(t.requests.channelId)

  return { items, counts, byChannel: Object.fromEntries(byChannel.map((r) => [r.channelId, r.n])) }
})

const ManualBody = z.object({
  channelId: z.string().uuid(),
  name: z.string().trim().min(1, "укажите имя").max(200),
  phone: z.string().trim().max(40).optional(),
  email: z.string().trim().max(200).optional(),
  subject: z.string().trim().max(300).optional(),
  text: z.string().trim().min(1, "опишите обращение").max(20000),
  priority: z.enum(["low", "normal", "high", "urgent"]).optional(),
  category: z.string().trim().max(100).optional(),
})

/** Обращение, заведённое вручную: звонок, личный визит, письмо по почте. */
export const POST = api(async (req, _ctx, user) => {
  const body = await readJson(req, ManualBody)
  const [channel] = await db.select().from(t.channels).where(eq(t.channels.id, body.channelId)).limit(1)
  if (!channel || channel.kind !== "manual") throw new HttpError(400, "Вручную обращения заводятся в канал «Телефон и личный приём»")
  const key = body.phone || body.email || `manual:${crypto.randomUUID()}`
  const result = await ingestIncoming(channel, {
    externalUserId: key,
    replyTo: body.phone || body.email || "",
    name: body.name,
    phone: body.phone,
    email: body.email,
    subject: body.subject,
    text: body.text,
    meta: { createdBy: user.id },
  })
  if (!result) throw new HttpError(400, "Пустое обращение")
  await db
    .update(t.requests)
    .set({
      priority: body.priority ?? "normal",
      category: body.category ?? null,
      assigneeId: user.id,
      status: "open",
      unread: 0,
    })
    .where(eq(t.requests.id, result.requestId))
  await db.insert(t.messages).values({
    requestId: result.requestId,
    direction: "internal",
    authorType: "system",
    text: `Обращение заведено вручную — ${user.name}`,
  })
  publish({ type: "request.updated", requestId: result.requestId })
  return { id: result.requestId }
})
