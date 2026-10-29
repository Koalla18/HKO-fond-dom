import { and, desc, eq, inArray, sql } from "drizzle-orm"
import { db, t } from "@/db"
import { isUniqueViolation } from "@/db/errors"
import type { Channel } from "@/db/schema"
import { publish } from "@/lib/events"
import { CHANNELS, type ChannelKind } from "./catalog"
import type { IncomingMessage } from "./types"

/** Решённая заявка снова открывается, если человек написал в течение этого срока. */
export const REOPEN_WINDOW_MS = 72 * 3600 * 1000

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

export type IngestResult = { requestId: string; messageId: string; createdRequest: boolean }

export function normalizePhone(value?: string | null): string | null {
  if (!value) return null
  const digits = value.replace(/\D/g, "")
  if (digits.length < 10) return null
  if (digits.length === 11 && digits.startsWith("8")) return `+7${digits.slice(1)}`
  if (digits.length === 10) return `+7${digits}`
  return `+${digits}`
}

export function normalizeEmail(value?: string | null): string | null {
  const v = value?.trim().toLowerCase()
  return v && /.+@.+\..+/.test(v) ? v : null
}

export function previewOf(text: string, attachments: { name: string }[] = []): string {
  const flat = text.replace(/\s+/g, " ").trim()
  if (flat) return flat.length > 160 ? `${flat.slice(0, 157)}…` : flat
  if (attachments.length) return `📎 ${attachments.map((a) => a.name).join(", ")}`.slice(0, 160)
  return ""
}

function placeholderName(kind: ChannelKind, message: IncomingMessage) {
  if (message.externalUserId.startsWith("visitor:")) return `Посетитель сайта ${message.externalUserId.slice(8, 12).toUpperCase()}`
  const who = message.handle ? `@${message.handle.replace(/^@/, "")}` : (message.email ?? message.externalUserId)
  return `${CHANNELS[kind].short}: ${who}`
}

async function findOrCreateContact(tx: Tx, channel: Channel, message: IncomingMessage) {
  const email = normalizeEmail(message.email)
  const phone = normalizePhone(message.phone)
  const name = message.name?.trim() || null

  const [identity] = await tx
    .select()
    .from(t.contactIdentities)
    .where(and(eq(t.contactIdentities.channelId, channel.id), eq(t.contactIdentities.externalId, message.externalUserId)))
    .limit(1)

  if (identity) {
    const [contact] = await tx.select().from(t.contacts).where(eq(t.contacts.id, identity.contactId)).limit(1)
    // Имя «Почта: @ivan» заменяем настоящим, как только площадка его сообщила.
    const patch: Partial<typeof t.contacts.$inferInsert> = {}
    if (name && contact.name.includes(":") && contact.name !== name) patch.name = name
    if (email && !contact.email) patch.email = email
    if (phone && !contact.phone) patch.phone = phone
    if (message.avatarUrl && !contact.avatarUrl) patch.avatarUrl = message.avatarUrl
    if (Object.keys(patch).length) await tx.update(t.contacts).set(patch).where(eq(t.contacts.id, contact.id))
    if (message.handle && message.handle !== identity.handle) {
      await tx.update(t.contactIdentities).set({ handle: message.handle }).where(eq(t.contactIdentities.id, identity.id))
    }
    return { ...contact, ...patch }
  }

  // Тот же человек мог писать из другого канала — склеиваем по почте или телефону.
  let contact =
    (email && (await tx.select().from(t.contacts).where(eq(t.contacts.email, email)).limit(1))[0]) ||
    (phone && (await tx.select().from(t.contacts).where(eq(t.contacts.phone, phone)).limit(1))[0]) ||
    null

  if (!contact) {
    ;[contact] = await tx
      .insert(t.contacts)
      .values({
        name: name ?? placeholderName(channel.kind as ChannelKind, message),
        email,
        phone,
        avatarUrl: message.avatarUrl ?? null,
      })
      .returning()
  }

  await tx.insert(t.contactIdentities).values({
    contactId: contact.id,
    channelId: channel.id,
    externalId: message.externalUserId,
    handle: message.handle ?? null,
    profileUrl: message.profileUrl ?? null,
  })
  return contact
}

async function findRequestByThread(tx: Tx, channelId: string, keys: string[]) {
  if (!keys.length) return null
  const [hit] = await tx
    .select({ requestId: t.messages.requestId })
    .from(t.messages)
    .where(and(eq(t.messages.channelId, channelId), inArray(sql`${t.messages.meta}->>'messageId'`, keys)))
    .orderBy(desc(t.messages.createdAt))
    .limit(1)
  if (!hit) return null
  const [request] = await tx.select().from(t.requests).where(eq(t.requests.id, hit.requestId)).limit(1)
  return request ?? null
}

/**
 * Принять входящее сообщение: найти или завести контакт, приложить к открытой
 * заявке или создать новую, записать сообщение. Повторная доставка того же
 * сообщения (тот же externalMessageId) ничего не делает и возвращает null.
 */
export async function ingestIncoming(channel: Channel, message: IncomingMessage): Promise<IngestResult | null> {
  const attachments = message.attachments ?? []
  const text = message.text ?? ""
  if (!text.trim() && !attachments.length) return null

  let result: IngestResult | null = null
  let reopened = false
  for (let attempt = 1; ; attempt++) {
    reopened = false
    try {
      result = await db.transaction(async (tx) => {
        if (message.externalMessageId) {
          const [dupe] = await tx
            .select({ id: t.messages.id })
            .from(t.messages)
            .where(and(eq(t.messages.channelId, channel.id), eq(t.messages.externalId, message.externalMessageId)))
            .limit(1)
          if (dupe) return null
        }

        const contact = await findOrCreateContact(tx, channel, message)
        const now = message.receivedAt ?? new Date()

        let request = await findRequestByThread(tx, channel.id, message.threadKeys ?? [])
        if (request && request.contactId !== contact.id) request = null
        // Человек ответил на конкретное письмо фонда — это продолжение той заявки, сколько бы времени ни прошло.
        const threaded = Boolean(request)
        if (!request) {
          const [latest] = await tx
            .select()
            .from(t.requests)
            .where(and(eq(t.requests.channelId, channel.id), eq(t.requests.contactId, contact.id)))
            .orderBy(desc(t.requests.lastMessageAt))
            .limit(1)
          request = latest ?? null
        }

        let createdRequest = false
        // Открытая заявка или спам — дописываем туда; недавно решённая — открываем снова;
        // давно решённая — человек пришёл с новым вопросом, заводим новую заявку.
        if (request && request.status === "resolved") {
          const fresh = request.resolvedAt && now.getTime() - request.resolvedAt.getTime() < REOPEN_WINDOW_MS
          if (fresh || threaded) reopened = true
          else request = null
        }

        if (!request) {
          ;[request] = await tx
            .insert(t.requests)
            .values({
              channelId: channel.id,
              contactId: contact.id,
              replyTo: message.replyTo,
              subject: message.subject?.trim() || null,
              status: "new",
              lastMessageAt: now,
            })
            .returning()
          createdRequest = true
        }

        const meta = { ...(message.meta ?? {}) }
        const [row] = await tx
          .insert(t.messages)
          .values({
            requestId: request.id,
            channelId: channel.id,
            direction: "in",
            authorType: "contact",
            text,
            attachments,
            externalId: message.externalMessageId ?? null,
            meta,
            createdAt: now,
          })
          .returning({ id: t.messages.id })

        if (reopened) {
          await tx.insert(t.messages).values({
            requestId: request.id,
            direction: "internal",
            authorType: "system",
            text: "Человек написал снова — обращение открыто повторно.",
            createdAt: new Date(now.getTime() - 1),
          })
        }

        const nextStatus = request.status === "spam" ? "spam" : reopened || request.status === "waiting" ? "open" : request.status
        await tx
          .update(t.requests)
          .set({
            status: nextStatus,
            resolvedAt: reopened ? null : request.resolvedAt,
            replyTo: message.replyTo,
            lastMessageAt: now,
            lastMessagePreview: previewOf(text, attachments),
            lastMessageDirection: "in",
            unread: sql`${t.requests.unread} + 1`,
            subject: request.subject ?? (message.subject?.trim() || null),
          })
          .where(eq(t.requests.id, request.id))

        await tx.update(t.channels).set({ lastActivityAt: new Date() }).where(eq(t.channels.id, channel.id))
        return { requestId: request.id, messageId: row.id, createdRequest }
      })
      break
    } catch (err) {
      // Два сообщения пришли одновременно и оба создавали контакт/сообщение: проигравший
      // повторяет попытку — контакт уже есть, а дубль того же сообщения отсечёт проверка выше.
      if (isUniqueViolation(err) && attempt < 3) continue
      throw err
    }
  }

  if (result) {
    publish({ type: result.createdRequest ? "request.created" : "request.updated", requestId: result.requestId })
    publish({ type: "message.created", requestId: result.requestId, messageId: result.messageId })
    const { notifyAgent } = await import("@/lib/agent")
    void notifyAgent({ requestId: result.requestId, messageId: result.messageId, createdRequest: result.createdRequest })
  }
  return result
}
