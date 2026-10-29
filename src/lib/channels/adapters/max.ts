import type { Attachment } from "@/db/schema"
import { downloadToStorage } from "@/lib/storage"
import { ChannelApiError, chunkText, fetchJson, greetingText } from "../http"
import type { AdapterContext, ChannelAdapter, IncomingMessage } from "../types"

/** API ботов мессенджера MAX (dev.max.ru). Токен — в заголовке Authorization. */
const API_BASE = () => (process.env.MAX_API_BASE ?? "https://platform-api2.max.ru").replace(/\/$/, "")

type MaxUser = { user_id: number; first_name?: string; last_name?: string; name?: string; username?: string; is_bot?: boolean }
type MaxAttachment = { type: string; payload?: { url?: string; token?: string }; filename?: string }
export type MaxMessage = {
  sender?: MaxUser
  recipient: { chat_id?: number; user_id?: number; chat_type?: string }
  timestamp: number
  body: { mid: string; text?: string; attachments?: MaxAttachment[] }
  link?: { type: string; message?: { mid?: string; text?: string } }
}
type MaxUpdate = {
  update_type: string
  timestamp: number
  message?: MaxMessage
  chat_id?: number
  user?: MaxUser
}

function token(secrets: Record<string, string>) {
  if (!secrets.token) throw new ChannelApiError("Не указан токен бота MAX", false)
  return secrets.token
}

function api<T>(botToken: string, path: string, init: RequestInit & { timeoutMs?: number } = {}) {
  return fetchJson<T>(`${API_BASE()}${path}`, {
    ...init,
    headers: { Authorization: botToken, "content-type": "application/json", ...(init.headers ?? {}) },
  })
}

const FILE_NAMES: Record<string, string> = { image: "photo.jpg", video: "video.mp4", audio: "audio.mp3", file: "file" }

export async function maxToIncoming(message: MaxMessage): Promise<IncomingMessage | null> {
  const sender = message.sender
  if (!sender || sender.is_bot) return null
  const files: Attachment[] = []
  const notes: string[] = []
  for (const a of message.body.attachments ?? []) {
    if (a.payload?.url && FILE_NAMES[a.type]) files.push(await downloadToStorage(a.payload.url, a.filename ?? FILE_NAMES[a.type]))
    else if (a.type === "sticker") notes.push("[стикер]")
    else if (a.type === "location") notes.push("[геолокация]")
    else if (a.type === "contact") notes.push("[контакт]")
  }
  const name = sender.name ?? [sender.first_name, sender.last_name].filter(Boolean).join(" ")
  const chatId = message.recipient.chat_id
  return {
    externalUserId: String(sender.user_id),
    // В личном диалоге отвечаем в тот же чат; без chat_id — напрямую пользователю.
    replyTo: chatId ? `chat:${chatId}` : `user:${sender.user_id}`,
    name: name || undefined,
    handle: sender.username,
    text: [message.body.text ?? "", ...notes].filter(Boolean).join("\n"),
    attachments: files,
    externalMessageId: message.body.mid,
    receivedAt: new Date(message.timestamp),
    meta:
      message.link?.type === "reply"
        ? { replyToExternalId: message.link.message?.mid, replyToText: message.link.message?.text ?? "" }
        : undefined,
  }
}

async function handleUpdate(ctx: AdapterContext, update: MaxUpdate) {
  const botToken = token(ctx.secrets)
  if (update.update_type === "bot_started" && (update.chat_id || update.user?.user_id)) {
    const target = update.chat_id ? `chat_id=${update.chat_id}` : `user_id=${update.user!.user_id}`
    await api(botToken, `/messages?${target}`, { method: "POST", body: JSON.stringify({ text: greetingText(ctx.config) }) })
    return
  }
  if (update.update_type !== "message_created" || !update.message) return
  if (update.message.recipient.chat_type && update.message.recipient.chat_type !== "dialog") return
  const incoming = await maxToIncoming(update.message)
  if (incoming) await ctx.ingest(incoming)
}

export const maxAdapter: ChannelAdapter = {
  kind: "max",

  async test(ctx) {
    const me = await api<MaxUser>(token(ctx.secrets), "/me")
    return `Бот ${me.name ?? me.first_name ?? ""}${me.username ? ` (@${me.username})` : ""}`.trim()
  },

  async run(ctx) {
    const botToken = token(ctx.secrets)
    const me = await api<MaxUser>(botToken, "/me", { signal: ctx.signal })
    await ctx.setStatus("ok", `Получаем сообщения бота ${me.username ? `@${me.username}` : me.name ?? ""}`.trim())
    let marker = ctx.config._marker as number | undefined
    while (!ctx.signal.aborted) {
      const qs = new URLSearchParams({ timeout: "30", limit: "100", types: "message_created,bot_started" })
      if (marker !== undefined) qs.set("marker", String(marker))
      const res = await api<{ updates: MaxUpdate[]; marker?: number }>(botToken, `/updates?${qs}`, {
        signal: ctx.signal,
        timeoutMs: 45_000,
      }).catch((err) => {
        if (ctx.signal.aborted) return { updates: [] as MaxUpdate[], marker }
        throw err
      })
      for (const update of res.updates ?? []) await handleUpdate(ctx, update)
      if (res.marker !== undefined && res.marker !== marker) {
        marker = res.marker
        await ctx.saveState({ _marker: marker })
      }
    }
  },

  async webhook(_req, ctx, rawBody) {
    await handleUpdate(ctx, JSON.parse(rawBody) as MaxUpdate)
    return new Response("ok")
  },

  async send({ secrets, request, text, replyTo }) {
    const botToken = token(secrets)
    const [kind, id] = request.replyTo.split(":")
    const target = kind === "user" ? `user_id=${id}` : `chat_id=${id}`
    let link: { link: { type: "reply"; mid: string } } | undefined = replyTo?.externalId ? { link: { type: "reply", mid: replyTo.externalId } } : undefined
    let last: { message?: { body?: { mid?: string } } } | undefined
    for (const part of chunkText(text, 4000)) {
      last = await api(botToken, `/messages?${target}`, { method: "POST", body: JSON.stringify({ text: part, ...link }) })
      link = undefined
    }
    return { externalId: last?.message?.body?.mid }
  },
}
