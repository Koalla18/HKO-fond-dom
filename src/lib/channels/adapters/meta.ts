import { createHmac, timingSafeEqual } from "node:crypto"
import type { Attachment } from "@/db/schema"
import { downloadToStorage } from "@/lib/storage"
import type { ChannelKind } from "../catalog"
import { ChannelApiError, chunkText, fetchJson, waitForAbort } from "../http"
import { withQuote } from "../reply"
import type { AdapterContext, ChannelAdapter, ChannelConfig, ChannelSecrets, IncomingMessage } from "../types"

/** Общая часть Instagram Messaging API, Messenger и WhatsApp Cloud API (graph.facebook.com). */
export const GRAPH = "https://graph.facebook.com/v21.0"

export function verifyMetaSignature(rawBody: string, header: string | null, appSecret: string | undefined) {
  if (!appSecret || !header?.startsWith("sha256=")) return false
  const expected = createHmac("sha256", appSecret).update(rawBody, "utf8").digest()
  const got = Buffer.from(header.slice(7), "hex")
  return got.length === expected.length && timingSafeEqual(got, expected)
}

/** Ответ на проверку вебхука при подписке в кабинете Meta. */
export function metaVerification(req: Request, config: ChannelConfig): Response | null {
  if (req.method !== "GET") return null
  const url = new URL(req.url)
  const ok = url.searchParams.get("hub.mode") === "subscribe" && url.searchParams.get("hub.verify_token") === config.verifyToken
  return ok ? new Response(url.searchParams.get("hub.challenge") ?? "") : new Response("forbidden", { status: 403 })
}

function token(secrets: ChannelSecrets) {
  if (!secrets.accessToken) throw new ChannelApiError("Не указан токен доступа", false)
  return secrets.accessToken
}

type MessagingEvent = {
  sender: { id: string }
  recipient: { id: string }
  timestamp: number
  message?: { mid: string; text?: string; is_echo?: boolean; attachments?: { type: string; payload?: { url?: string } }[] }
}

const profileCache = new Map<string, { name?: string; handle?: string }>()

async function profileOf(kind: ChannelKind, id: string, accessToken: string) {
  const key = `${kind}:${id}`
  if (profileCache.has(key)) return profileCache.get(key)!
  const fields = kind === "instagram" ? "name,username" : "first_name,last_name"
  try {
    const p = await fetchJson<{ name?: string; username?: string; first_name?: string; last_name?: string }>(
      `${GRAPH}/${id}?fields=${fields}&access_token=${encodeURIComponent(accessToken)}`,
    )
    const value = { name: p.name ?? ([p.first_name, p.last_name].filter(Boolean).join(" ") || undefined), handle: p.username }
    profileCache.set(key, value)
    return value
  } catch {
    return {}
  }
}

export async function metaEventToIncoming(kind: ChannelKind, event: MessagingEvent, accessToken: string): Promise<IncomingMessage | null> {
  const message = event.message
  if (!message || message.is_echo) return null
  const files: Attachment[] = []
  for (const a of message.attachments ?? []) {
    if (a.payload?.url) files.push(await downloadToStorage(a.payload.url, a.type === "image" ? "photo.jpg" : a.type))
  }
  const profile = await profileOf(kind, event.sender.id, accessToken)
  return {
    externalUserId: event.sender.id,
    replyTo: event.sender.id,
    name: profile.name,
    handle: profile.handle,
    profileUrl: kind === "instagram" && profile.handle ? `https://instagram.com/${profile.handle}` : undefined,
    text: message.text ?? "",
    attachments: files,
    externalMessageId: message.mid,
    receivedAt: new Date(event.timestamp),
  }
}

function makeMetaAdapter(kind: "instagram" | "facebook"): ChannelAdapter {
  return {
    kind,
    async test(ctx) {
      const me = await fetchJson<{ id: string; name?: string }>(`${GRAPH}/me?fields=id,name&access_token=${encodeURIComponent(token(ctx.secrets))}`)
      return `Страница «${me.name ?? me.id}»`
    },
    async run(ctx: AdapterContext) {
      token(ctx.secrets)
      await ctx.setStatus("ok", "Ждём события от Meta на адрес вебхука")
      await waitForAbort(ctx.signal)
    },
    async webhook(req, ctx, rawBody) {
      const verification = metaVerification(req, ctx.config)
      if (verification) return verification
      if (!verifyMetaSignature(rawBody, req.headers.get("x-hub-signature-256"), ctx.secrets.appSecret)) {
        return new Response("bad signature", { status: 401 })
      }
      const body = JSON.parse(rawBody) as { object: string; entry?: { messaging?: MessagingEvent[] }[] }
      for (const entry of body.entry ?? []) {
        for (const event of entry.messaging ?? []) {
          const incoming = await metaEventToIncoming(kind, event, token(ctx.secrets))
          if (incoming) await ctx.ingest(incoming)
        }
      }
      return new Response("EVENT_RECEIVED")
    },
    async send({ secrets, request, text, replyTo }) {
      let last: { message_id?: string } = {}
      for (const part of chunkText(withQuote(text, replyTo), 990)) {
        last = await fetchJson<{ message_id?: string }>(`${GRAPH}/me/messages?access_token=${encodeURIComponent(token(secrets))}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ recipient: { id: request.replyTo }, messaging_type: "RESPONSE", message: { text: part } }),
        })
      }
      return { externalId: last.message_id }
    },
  }
}

export const instagramAdapter = makeMetaAdapter("instagram")
export const facebookAdapter = makeMetaAdapter("facebook")
