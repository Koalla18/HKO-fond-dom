import { createHash } from "node:crypto"
import { downloadToStorage, readStoredFile } from "@/lib/storage"
import type { Attachment } from "@/db/schema"
import { ChannelApiError, chunkText, fetchJson, greetingText, waitForAbort } from "../http"
import { trailingId } from "../reply"
import type { AdapterContext, ChannelAdapter, IncomingMessage } from "../types"

type TgUser = { id: number; first_name?: string; last_name?: string; username?: string; is_bot?: boolean }
type TgFile = { file_id: string; file_name?: string; mime_type?: string; file_size?: number }
type TgMessage = {
  message_id: number
  reply_to_message?: { message_id: number; text?: string; caption?: string }
  date: number
  chat: { id: number; type: string; title?: string }
  from?: TgUser
  text?: string
  caption?: string
  photo?: TgFile[]
  document?: TgFile
  voice?: TgFile
  audio?: TgFile
  video?: TgFile
  video_note?: TgFile
  sticker?: { emoji?: string }
  contact?: { phone_number: string; first_name?: string }
  location?: { latitude: number; longitude: number }
}
type TgUpdate = { update_id: number; message?: TgMessage }

/** Адрес Bot API. В России api.telegram.org часто недоступен по IPv4 — можно указать свой прокси. */
const API_BASE = () => (process.env.TELEGRAM_API_BASE ?? "https://api.telegram.org").replace(/\/$/, "")

function token(secrets: Record<string, string>) {
  if (!secrets.botToken) throw new ChannelApiError("Не указан токен бота", false)
  return secrets.botToken
}

async function call<T>(botToken: string, method: string, body?: unknown, signal?: AbortSignal, timeoutMs = 30_000) {
  const res = await fetchJson<{ ok: boolean; result: T; description?: string }>(`${API_BASE()}/bot${botToken}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body ?? {}),
    signal,
    timeoutMs,
  })
  if (!res.ok) throw new ChannelApiError(res.description ?? "Telegram отклонил запрос")
  return res.result
}

/** Секрет вебхука выводим из токена — Telegram пришлёт его в заголовке. */
export function telegramWebhookSecret(botToken: string) {
  return createHash("sha256").update(`dom-inbox:${botToken}`).digest("hex").slice(0, 48)
}

async function fileAttachment(botToken: string, file: TgFile, fallback: string): Promise<Attachment> {
  try {
    const info = await call<{ file_path?: string }>(botToken, "getFile", { file_id: file.file_id })
    if (!info.file_path) throw new Error("no path")
    const name = file.file_name ?? info.file_path.split("/").pop() ?? fallback
    return await downloadToStorage(`${API_BASE()}/file/bot${botToken}/${info.file_path}`, name)
  } catch {
    // Файлы больше 20 МБ бот скачать не может — оставляем пометку.
    return { name: file.file_name ?? fallback, mime: file.mime_type ?? "application/octet-stream", url: "" }
  }
}

export async function telegramToIncoming(botToken: string, msg: TgMessage): Promise<IncomingMessage | null> {
  if (!msg.from || msg.from.is_bot) return null
  const attachments: Attachment[] = []
  if (msg.photo?.length) attachments.push(await fileAttachment(botToken, msg.photo[msg.photo.length - 1], "photo.jpg"))
  if (msg.document) attachments.push(await fileAttachment(botToken, msg.document, "file"))
  if (msg.voice) attachments.push(await fileAttachment(botToken, msg.voice, "voice.ogg"))
  if (msg.audio) attachments.push(await fileAttachment(botToken, msg.audio, "audio"))
  if (msg.video) attachments.push(await fileAttachment(botToken, msg.video, "video.mp4"))
  if (msg.video_note) attachments.push(await fileAttachment(botToken, msg.video_note, "video-note.mp4"))

  let text = msg.text ?? msg.caption ?? ""
  if (msg.sticker) text = text || `[стикер ${msg.sticker.emoji ?? ""}]`.trim()
  if (msg.location) text = `${text}\nГеолокация: https://yandex.ru/maps/?pt=${msg.location.longitude},${msg.location.latitude}&z=16`.trim()
  if (msg.contact) text = `${text}\nПоделился телефоном: ${msg.contact.phone_number}`.trim()

  const name = [msg.from.first_name, msg.from.last_name].filter(Boolean).join(" ")
  return {
    externalUserId: String(msg.from.id),
    replyTo: String(msg.chat.id),
    name: name || undefined,
    handle: msg.from.username,
    profileUrl: msg.from.username ? `https://t.me/${msg.from.username}` : undefined,
    phone: msg.contact?.phone_number,
    text,
    attachments,
    externalMessageId: `${msg.chat.id}:${msg.message_id}`,
    receivedAt: new Date(msg.date * 1000),
    meta: {
      chatType: msg.chat.type,
      ...(msg.reply_to_message
        ? { replyToExternalId: `${msg.chat.id}:${msg.reply_to_message.message_id}`, replyToText: msg.reply_to_message.text ?? msg.reply_to_message.caption ?? "" }
        : {}),
    },
  }
}

async function handleUpdate(ctx: AdapterContext, update: TgUpdate) {
  const msg = update.message
  if (!msg || msg.chat.type !== "private") return // группы не принимаем — только личные сообщения боту
  const botToken = token(ctx.secrets)
  if (msg.text?.trim().startsWith("/start")) {
    await call(botToken, "sendMessage", { chat_id: msg.chat.id, text: greetingText(ctx.config) })
    return
  }
  const incoming = await telegramToIncoming(botToken, msg)
  if (incoming) await ctx.ingest(incoming)
}

export const telegramAdapter: ChannelAdapter = {
  kind: "telegram",

  async test(ctx) {
    const me = await call<{ username: string; first_name: string }>(token(ctx.secrets), "getMe")
    return `Бот @${me.username} (${me.first_name})`
  },

  async run(ctx) {
    const botToken = token(ctx.secrets)
    const appUrl = process.env.APP_URL ?? ""
    if (ctx.config.mode === "webhook") {
      if (!appUrl.startsWith("https://")) throw new ChannelApiError("Для вебхука нужен APP_URL с https://", false)
      await call(botToken, "setWebhook", {
        url: `${appUrl}/api/webhooks/${ctx.channel.id}`,
        secret_token: telegramWebhookSecret(botToken),
        allowed_updates: ["message"],
      })
      await ctx.setStatus("ok", "Вебхук установлен")
      await waitForAbort(ctx.signal)
      return
    }

    await call(botToken, "deleteWebhook", { drop_pending_updates: false })
    const me = await call<{ username: string }>(botToken, "getMe")
    await ctx.setStatus("ok", `Получаем сообщения бота @${me.username}`)
    let offset = Number(ctx.config._offset ?? 0)
    while (!ctx.signal.aborted) {
      const updates = await call<TgUpdate[]>(
        botToken,
        "getUpdates",
        { offset, timeout: 25, allowed_updates: ["message"] },
        ctx.signal,
        40_000,
      ).catch((err) => {
        if (ctx.signal.aborted) return [] as TgUpdate[]
        throw err
      })
      for (const update of updates) {
        await handleUpdate(ctx, update)
        offset = update.update_id + 1
        await ctx.saveState({ _offset: offset })
      }
    }
  },

  async webhook(req, ctx, rawBody) {
    const botToken = token(ctx.secrets)
    if (req.headers.get("x-telegram-bot-api-secret-token") !== telegramWebhookSecret(botToken)) {
      return new Response("forbidden", { status: 403 })
    }
    await handleUpdate(ctx, JSON.parse(rawBody) as TgUpdate)
    return new Response("ok")
  },

  async send({ secrets, request, text, attachments, replyTo }) {
    const botToken = token(secrets)
    const replyId = trailingId(replyTo?.externalId)
    // Ответ цитатой: Telegram показывает исходное сообщение над нашим.
    let reply: Record<string, unknown> | undefined = replyId ? { reply_parameters: { message_id: replyId, allow_sending_without_reply: true } } : undefined
    let last: { message_id: number } | undefined
    for (const part of text ? chunkText(text, 4000) : []) {
      last = await call<{ message_id: number }>(botToken, "sendMessage", { chat_id: request.replyTo, text: part, ...reply })
      reply = undefined
    }
    for (const file of attachments) {
      const id = file.url.split("/").pop() ?? ""
      const stored = await readStoredFile(id)
      if (!stored) continue
      const form = new FormData()
      form.set("chat_id", request.replyTo)
      if (reply) {
        form.set("reply_parameters", JSON.stringify(reply.reply_parameters))
        reply = undefined
      }
      form.set("document", new Blob([new Uint8Array(stored.data)], { type: stored.mime }), stored.name)
      const res = await fetchJson<{ ok: boolean; result: { message_id: number } }>(`${API_BASE()}/bot${botToken}/sendDocument`, {
        method: "POST",
        body: form,
        timeoutMs: 60_000,
      })
      last = res.result
    }
    return { externalId: last ? `${request.replyTo}:${last.message_id}` : undefined }
  },
}
