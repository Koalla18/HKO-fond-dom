import { normalizeEmail, normalizePhone } from "@/lib/channels/ingest"
import { quoteExcerpt, quoteLabel } from "@/lib/channels/reply"
import { and, asc, desc, eq, ne } from "drizzle-orm"
import { z } from "zod"
import { db, t } from "@/db"
import { api, HttpError } from "@/lib/auth"
import { PRIORITY_LABELS, STATUS_LABELS } from "@/lib/channels/catalog"
import { publish } from "@/lib/events"
import { readJson } from "@/lib/validate"

type Ctx = { params: Promise<{ id: string }> }

async function loadRequest(id: string) {
  if (!z.string().uuid().safeParse(id).success) throw new HttpError(404, "Обращение не найдено")
  const [row] = await db
    .select({ request: t.requests, contact: t.contacts, channel: { id: t.channels.id, kind: t.channels.kind, name: t.channels.name } })
    .from(t.requests)
    .innerJoin(t.contacts, eq(t.contacts.id, t.requests.contactId))
    .innerJoin(t.channels, eq(t.channels.id, t.requests.channelId))
    .where(eq(t.requests.id, id))
    .limit(1)
  if (!row) throw new HttpError(404, "Обращение не найдено")
  return row
}

type Row = { id: string; text: string; attachments: { name: string }[]; externalId: string | null; meta: Record<string, unknown> }

/**
 * Цитаты ответов. Наши ответы помнят id исходного сообщения; входящие ответы из мессенджеров
 * приходят с id сообщения площадки — находим его в переписке, иначе показываем присланный текст.
 */
function withReplies<T extends Row>(rows: T[]) {
  const byExternal = new Map(rows.filter((r) => r.externalId).map((r) => [r.externalId!, r]))
  return rows.map((row) => {
    const { meta, ...rest } = row
    delete (rest as Partial<T>).externalId
    const own = meta.replyTo as { id?: string; text?: string } | undefined
    let replyTo: { id: string | null; text: string } | null = null
    if (own?.id) replyTo = { id: own.id, text: own.text ?? "" }
    else if (typeof meta.replyToExternalId === "string" || typeof meta.replyToText === "string") {
      const found = typeof meta.replyToExternalId === "string" ? byExternal.get(meta.replyToExternalId) : undefined
      const text = found ? quoteLabel({ text: found.text, attachments: found.attachments as never }) : quoteExcerpt(String(meta.replyToText ?? ""))
      if (found || text) replyTo = { id: found?.id ?? null, text: text || "Сообщение" }
    }
    return { ...rest, replyTo }
  })
}

/** Карточка заявки: переписка, человек, его способы связи и прошлые обращения из всех каналов. */
export const GET = api(async (_req, ctx: Ctx) => {
  const { id } = await ctx.params
  const { request, contact, channel } = await loadRequest(id)

  const rows = await db
    .select({
      id: t.messages.id,
      direction: t.messages.direction,
      authorType: t.messages.authorType,
      authorName: t.users.name,
      text: t.messages.text,
      attachments: t.messages.attachments,
      delivery: t.messages.delivery,
      deliveryError: t.messages.deliveryError,
      createdAt: t.messages.createdAt,
      externalId: t.messages.externalId,
      meta: t.messages.meta,
    })
    .from(t.messages)
    .leftJoin(t.users, eq(t.users.id, t.messages.authorUserId))
    .where(eq(t.messages.requestId, id))
    .orderBy(asc(t.messages.createdAt))
  const messages = withReplies(rows)

  const identities = await db
    .select({
      id: t.contactIdentities.id,
      externalId: t.contactIdentities.externalId,
      handle: t.contactIdentities.handle,
      profileUrl: t.contactIdentities.profileUrl,
      channel: { id: t.channels.id, kind: t.channels.kind, name: t.channels.name },
    })
    .from(t.contactIdentities)
    .innerJoin(t.channels, eq(t.channels.id, t.contactIdentities.channelId))
    .where(eq(t.contactIdentities.contactId, contact.id))

  const history = await db
    .select({
      id: t.requests.id,
      number: t.requests.number,
      status: t.requests.status,
      subject: t.requests.subject,
      lastMessagePreview: t.requests.lastMessagePreview,
      createdAt: t.requests.createdAt,
      channel: { kind: t.channels.kind, name: t.channels.name },
    })
    .from(t.requests)
    .innerJoin(t.channels, eq(t.channels.id, t.requests.channelId))
    .where(and(eq(t.requests.contactId, contact.id), ne(t.requests.id, id)))
    .orderBy(desc(t.requests.createdAt))
    .limit(20)

  if (request.unread > 0) {
    await db.update(t.requests).set({ unread: 0 }).where(eq(t.requests.id, id))
    publish({ type: "request.updated", requestId: id })
  }

  return { request: { ...request, unread: 0 }, contact, channel, messages, identities, history }
})

const Patch = z.object({
  status: z.enum(["new", "open", "waiting", "resolved", "spam"]).optional(),
  priority: z.enum(["low", "normal", "high", "urgent"]).optional(),
  category: z.string().trim().max(100).nullable().optional(),
  assigneeId: z.string().uuid().nullable().optional(),
  subject: z.string().trim().max(300).nullable().optional(),
  aiHandling: z.boolean().optional(),
  contactName: z.string().trim().min(1).max(200).optional(),
  contactPhone: z.string().trim().max(40).nullable().optional(),
  contactEmail: z.string().trim().max(200).nullable().optional(),
  contactNote: z.string().trim().max(5000).nullable().optional(),
})

/** Статус, срочность, категория, ответственный — и запись об изменении в ленте заявки. */
export const PATCH = api(async (req, ctx: Ctx, user) => {
  const { id } = await ctx.params
  const { request, contact } = await loadRequest(id)
  const body = await readJson(req, Patch)
  const notes: string[] = []

  const set: Partial<typeof t.requests.$inferInsert> = {}
  if (body.status && body.status !== request.status) {
    set.status = body.status
    set.resolvedAt = body.status === "resolved" ? new Date() : null
    notes.push(`Статус: ${STATUS_LABELS[body.status]}`)
  }
  if (body.priority && body.priority !== request.priority) {
    set.priority = body.priority
    notes.push(`Срочность: ${PRIORITY_LABELS[body.priority]}`)
  }
  if (body.category !== undefined && body.category !== request.category) {
    set.category = body.category || null
    notes.push(body.category ? `Категория: ${body.category}` : "Категория снята")
  }
  if (body.assigneeId !== undefined && body.assigneeId !== request.assigneeId) {
    if (body.assigneeId) {
      const [assignee] = await db.select({ name: t.users.name }).from(t.users).where(eq(t.users.id, body.assigneeId)).limit(1)
      if (!assignee) throw new HttpError(400, "Сотрудник не найден")
      notes.push(`Ответственный: ${assignee.name}`)
    } else notes.push("Ответственный снят")
    set.assigneeId = body.assigneeId
  }
  if (body.subject !== undefined) set.subject = body.subject || null
  if (body.aiHandling !== undefined && body.aiHandling !== request.aiHandling) {
    set.aiHandling = body.aiHandling
    notes.push(body.aiHandling ? "Обращение снова ведёт ИИ-агент" : "Обращение забрал сотрудник")
  }

  const contactSet: Partial<typeof t.contacts.$inferInsert> = {}
  if (body.contactName !== undefined) contactSet.name = body.contactName
  // Тот же формат, что у сообщений из каналов: иначе человек не склеится по телефону или почте.
  if (body.contactPhone !== undefined) contactSet.phone = body.contactPhone ? (normalizePhone(body.contactPhone) ?? body.contactPhone) : null
  if (body.contactEmail !== undefined) contactSet.email = body.contactEmail ? (normalizeEmail(body.contactEmail) ?? body.contactEmail.toLowerCase()) : null
  if (body.contactNote !== undefined) contactSet.note = body.contactNote || null

  if (Object.keys(set).length) await db.update(t.requests).set(set).where(eq(t.requests.id, id))
  if (Object.keys(contactSet).length) await db.update(t.contacts).set(contactSet).where(eq(t.contacts.id, contact.id))
  if (notes.length) {
    await db.insert(t.messages).values({
      requestId: id,
      direction: "internal",
      authorType: "system",
      authorUserId: user.id,
      text: `${notes.join(" · ")} — ${user.name}`,
    })
  }
  publish({ type: "request.updated", requestId: id })
  return { ok: true }
})
