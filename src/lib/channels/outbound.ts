import { and, desc, eq } from "drizzle-orm"
import { db, t } from "@/db"
import type { Attachment, Message } from "@/db/schema"
import { HttpError } from "@/lib/auth"
import { publish } from "@/lib/events"
import { CHANNELS, type ChannelKind } from "./catalog"
import { previewOf } from "./ingest"
import { getAdapter } from "./registry"
import { quoteLabel } from "./reply"
import { loadChannel } from "./store"

type Author = { type: "agent"; userId: string } | { type: "ai" } | { type: "system" }

/**
 * Ответ в заявку. internal=true — заметка для сотрудников, человеку не уходит.
 * Сообщение сохраняется сразу; если площадка не приняла его, оно помечается
 * «не доставлено» с причиной, и сотрудник видит это в переписке.
 */
export async function sendReply(input: {
  requestId: string
  text: string
  attachments?: Attachment[]
  internal?: boolean
  /** Ответ на конкретное сообщение переписки. */
  replyToId?: string | null
  author: Author
}) {
  const text = input.text.trim()
  const attachments = input.attachments ?? []
  if (!text && !attachments.length) throw new HttpError(400, "Пустое сообщение")

  const [request] = await db.select().from(t.requests).where(eq(t.requests.id, input.requestId)).limit(1)
  if (!request) throw new HttpError(404, "Обращение не найдено")
  const authorUserId = input.author.type === "agent" ? input.author.userId : null

  let replyTo: Message | null = null
  if (input.replyToId) {
    ;[replyTo] = await db
      .select()
      .from(t.messages)
      .where(and(eq(t.messages.id, input.replyToId), eq(t.messages.requestId, request.id)))
      .limit(1)
    if (!replyTo) throw new HttpError(400, "Сообщение для ответа не найдено в этой переписке")
  }
  const replyMeta = replyTo ? { replyTo: { id: replyTo.id, text: quoteLabel(replyTo) } } : {}

  if (input.internal) {
    const [note] = await db
      .insert(t.messages)
      .values({ requestId: request.id, direction: "internal", authorType: input.author.type, authorUserId, text, attachments, meta: replyMeta })
      .returning()
    publish({ type: "message.created", requestId: request.id, messageId: note.id })
    return note
  }

  const loaded = await loadChannel(request.channelId)
  if (!loaded) throw new HttpError(409, "Канал обращения удалён")
  const kind = loaded.channel.kind as ChannelKind
  if (!CHANNELS[kind]?.canReply) throw new HttpError(409, "В этот канал ответить нельзя — используйте заметку и перезвоните человеку")
  const adapter = getAdapter(kind)
  if (!adapter.send) throw new HttpError(409, "Канал не поддерживает ответы")
  if (attachments.length && !CHANNELS[kind].canSendFiles) {
    throw new HttpError(409, `${CHANNELS[kind].title}: отправка файлов отсюда пока не поддерживается — пришлите ссылку текстом`)
  }

  const [contact] = await db.select().from(t.contacts).where(eq(t.contacts.id, request.contactId)).limit(1)
  const [lastIncoming] = await db
    .select()
    .from(t.messages)
    .where(and(eq(t.messages.requestId, request.id), eq(t.messages.direction, "in")))
    .orderBy(desc(t.messages.createdAt))
    .limit(1)

  const [message] = await db
    .insert(t.messages)
    .values({
      requestId: request.id,
      channelId: loaded.channel.id,
      direction: "out",
      authorType: input.author.type,
      authorUserId,
      text,
      attachments,
      delivery: "pending",
      meta: replyMeta,
    })
    .returning()
  publish({ type: "message.created", requestId: request.id, messageId: message.id })

  let delivery: "sent" | "failed" = "sent"
  let deliveryError: string | null = null
  let externalId: string | null = null
  let meta: Record<string, unknown> = replyMeta
  try {
    const outgoingReplyTo = replyTo && replyTo.direction !== "internal" ? replyTo : null
    const result = await adapter.send({ ...loaded, request, contact, text, attachments, lastIncoming, replyTo: outgoingReplyTo })
    externalId = result.externalId ?? null
    meta = { ...replyMeta, ...(result.meta ?? {}) }
  } catch (err) {
    delivery = "failed"
    deliveryError = err instanceof Error ? err.message : String(err)
  }

  // Сообщение уже ушло человеку — статус «отправлено» должен сохраниться, даже если площадка
  // вернула id, который у нас уже записан (повторная доставка, сбой площадки).
  const save = (id: string | null) =>
    db.update(t.messages).set({ delivery, deliveryError, externalId: id, meta }).where(eq(t.messages.id, message.id)).returning()
  const [saved] = await save(externalId).catch(() => save(null))

  await db
    .update(t.requests)
    .set({
      lastMessageAt: new Date(),
      lastMessagePreview: previewOf(text, attachments),
      lastMessageDirection: "out",
      unread: 0,
      // Ответили — ждём человека. Ответ сотрудника забирает заявку у ИИ-агента.
      status: request.status === "new" || request.status === "open" ? "waiting" : request.status,
      ...(input.author.type === "agent" ? { aiHandling: false } : {}),
      ...(input.author.type === "agent" && !request.assigneeId ? { assigneeId: input.author.userId } : {}),
    })
    .where(eq(t.requests.id, request.id))

  publish({ type: "message.created", requestId: request.id, messageId: message.id })
  publish({ type: "request.updated", requestId: request.id })
  return saved
}
