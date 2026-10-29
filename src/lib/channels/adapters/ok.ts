import type { Attachment } from "@/db/schema"
import { downloadToStorage } from "@/lib/storage"
import { ChannelApiError, chunkText, fetchJson, waitForAbort } from "../http"
import { withQuote } from "../reply"
import type { AdapterContext, ChannelAdapter, IncomingMessage } from "../types"

/**
 * Сообщения группы в Одноклассниках через Graph API ботов (apiok.ru/dev/graph_api/bot_api).
 * События приходят только вебхуком — нужен HTTPS-адрес платформы. Подписи у ОК нет,
 * поэтому в адрес вебхука добавляется секретный ключ канала.
 */
const API_BASE = () => (process.env.OK_API_BASE ?? "https://api.ok.ru/graph").replace(/\/$/, "")

type OkWebhook = {
  webhookType?: string
  sender?: { user_id?: string; name?: string }
  recipient?: { chat_id?: string }
  message?: { text?: string; attachments?: { type?: string; payload?: { url?: string; name?: string } }[] }
  mid?: string
  timestamp?: number
}

function token(secrets: Record<string, string>) {
  if (!secrets.token) throw new ChannelApiError("Не указан ключ доступа группы", false)
  return secrets.token
}

function okUrl(path: string, accessToken: string) {
  return `${API_BASE()}${path}${path.includes("?") ? "&" : "?"}access_token=${encodeURIComponent(accessToken)}`
}

async function ok<T>(path: string, accessToken: string, init: RequestInit = {}) {
  const res = await fetchJson<T & { error_code?: number; error_msg?: string }>(okUrl(path, accessToken), {
    ...init,
    headers: { "content-type": "application/json;charset=utf-8", ...(init.headers ?? {}) },
  })
  if (res && typeof res === "object" && "error_code" in res && res.error_code) {
    throw new ChannelApiError(`ОК: ${res.error_msg ?? res.error_code}`, res.error_code !== 102 && res.error_code !== 103)
  }
  return res as T
}

export async function okToIncoming(event: OkWebhook): Promise<IncomingMessage | null> {
  if (event.webhookType && event.webhookType !== "MESSAGE_CREATED") return null
  const userId = event.sender?.user_id
  const chatId = event.recipient?.chat_id
  if (!userId || !chatId) return null
  const files: Attachment[] = []
  for (const a of event.message?.attachments ?? []) {
    if (a.payload?.url) files.push(await downloadToStorage(a.payload.url, a.payload.name ?? (a.type === "IMAGE" ? "photo.jpg" : "file")))
  }
  const uid = userId.replace(/^user:/, "")
  return {
    externalUserId: userId,
    replyTo: chatId,
    name: event.sender?.name,
    profileUrl: /^\d+$/.test(uid) ? `https://ok.ru/profile/${uid}` : undefined,
    text: event.message?.text ?? "",
    attachments: files,
    externalMessageId: event.mid ?? `${chatId}:${event.timestamp}`,
    receivedAt: event.timestamp ? new Date(event.timestamp) : undefined,
  }
}

export const okAdapter: ChannelAdapter = {
  kind: "ok",

  async test(ctx) {
    const res = await ok<{ subscriptions?: { url: string }[] }>("/me/subscriptions", token(ctx.secrets))
    const n = res.subscriptions?.length ?? 0
    return `Ключ группы принят${n ? `, подписок на события: ${n}` : ""}`
  },

  async run(ctx: AdapterContext) {
    const accessToken = token(ctx.secrets)
    const appUrl = process.env.APP_URL ?? ""
    if (!appUrl.startsWith("https://")) {
      throw new ChannelApiError("Одноклассники присылают сообщения только на HTTPS-адрес — подключите домен платформы", false)
    }
    const url = `${appUrl}/api/webhooks/${ctx.channel.id}?key=${encodeURIComponent(String(ctx.config.webhookKey ?? ""))}`
    await ok("/me/subscribe", accessToken, { method: "POST", body: JSON.stringify({ url }) })
    await ctx.setStatus("ok", "Подписка на сообщения группы оформлена")
    await waitForAbort(ctx.signal)
  },

  async webhook(req, ctx, rawBody) {
    const key = new URL(req.url).searchParams.get("key")
    if (!ctx.config.webhookKey || key !== ctx.config.webhookKey) return new Response("forbidden", { status: 403 })
    if (req.method !== "POST") return new Response("ok")
    const incoming = await okToIncoming(JSON.parse(rawBody) as OkWebhook)
    if (incoming) await ctx.ingest(incoming)
    return new Response("ok")
  },

  async send({ secrets, request, text, replyTo }) {
    const accessToken = token(secrets)
    let mid: string | undefined
    for (const part of chunkText(withQuote(text, replyTo), 4000)) {
      const res = await ok<{ message_id?: string }>(`/${encodeURIComponent(request.replyTo)}/messages`, accessToken, {
        method: "POST",
        body: JSON.stringify({ recipient: { chat_id: request.replyTo }, message: { text: part } }),
      })
      mid = res.message_id ?? mid
    }
    return { externalId: mid }
  },
}
