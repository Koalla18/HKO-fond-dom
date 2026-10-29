import type { Attachment } from "@/db/schema"
import { downloadToStorage } from "@/lib/storage"
import { ChannelApiError, chunkText, fetchJson, waitForAbort } from "../http"
import type { ChannelAdapter, ChannelConfig, ChannelSecrets, IncomingMessage } from "../types"
import { GRAPH, metaVerification, verifyMetaSignature } from "./meta"

type WaMedia = { id: string; caption?: string; filename?: string; mime_type?: string }
type WaMessage = {
  from: string
  id: string
  timestamp: string
  type: string
  text?: { body: string }
  image?: WaMedia
  document?: WaMedia
  audio?: WaMedia
  video?: WaMedia
  location?: { latitude: number; longitude: number }
  context?: { id?: string }
}
type WaValue = { messages?: WaMessage[]; contacts?: { wa_id: string; profile?: { name?: string } }[] }

function creds(config: ChannelConfig, secrets: ChannelSecrets) {
  const phoneNumberId = String(config.phoneNumberId ?? "").trim()
  if (!phoneNumberId) throw new ChannelApiError("Не указан Phone number ID", false)
  if (!secrets.accessToken) throw new ChannelApiError("Не указан токен доступа", false)
  return { phoneNumberId, accessToken: secrets.accessToken }
}

async function media(accessToken: string, item: WaMedia, fallback: string): Promise<Attachment> {
  try {
    const info = await fetchJson<{ url: string }>(`${GRAPH}/${item.id}`, { headers: { Authorization: `Bearer ${accessToken}` } })
    return await downloadToStorage(info.url, item.filename ?? fallback, { headers: { Authorization: `Bearer ${accessToken}` } })
  } catch {
    return { name: item.filename ?? fallback, mime: item.mime_type ?? "application/octet-stream", url: "" }
  }
}

export async function waToIncoming(value: WaValue, message: WaMessage, accessToken: string): Promise<IncomingMessage> {
  const contact = value.contacts?.find((c) => c.wa_id === message.from)
  const files: Attachment[] = []
  if (message.image) files.push(await media(accessToken, message.image, "photo.jpg"))
  if (message.document) files.push(await media(accessToken, message.document, "file"))
  if (message.audio) files.push(await media(accessToken, message.audio, "voice.ogg"))
  if (message.video) files.push(await media(accessToken, message.video, "video.mp4"))
  let text = message.text?.body ?? message.image?.caption ?? message.document?.caption ?? message.video?.caption ?? ""
  if (message.location) {
    text = `${text}\nГеолокация: https://yandex.ru/maps/?pt=${message.location.longitude},${message.location.latitude}&z=16`.trim()
  }
  return {
    externalUserId: message.from,
    replyTo: message.from,
    name: contact?.profile?.name,
    phone: `+${message.from}`,
    text,
    attachments: files,
    externalMessageId: message.id,
    receivedAt: new Date(Number(message.timestamp) * 1000),
    meta: message.context?.id ? { replyToExternalId: message.context.id } : undefined,
  }
}

export const whatsappAdapter: ChannelAdapter = {
  kind: "whatsapp",
  async test(ctx) {
    const { phoneNumberId, accessToken } = creds(ctx.config, ctx.secrets)
    const info = await fetchJson<{ display_phone_number?: string; verified_name?: string }>(
      `${GRAPH}/${phoneNumberId}?fields=display_phone_number,verified_name`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    )
    return `Номер ${info.display_phone_number ?? phoneNumberId} (${info.verified_name ?? "без имени"})`
  },
  async run(ctx) {
    creds(ctx.config, ctx.secrets)
    await ctx.setStatus("ok", "Ждём события от Meta на адрес вебхука")
    await waitForAbort(ctx.signal)
  },
  async webhook(req, ctx, rawBody) {
    const verification = metaVerification(req, ctx.config)
    if (verification) return verification
    if (!verifyMetaSignature(rawBody, req.headers.get("x-hub-signature-256"), ctx.secrets.appSecret)) {
      return new Response("bad signature", { status: 401 })
    }
    const { accessToken } = creds(ctx.config, ctx.secrets)
    const body = JSON.parse(rawBody) as { entry?: { changes?: { value: WaValue }[] }[] }
    for (const entry of body.entry ?? []) {
      for (const change of entry.changes ?? []) {
        for (const message of change.value.messages ?? []) await ctx.ingest(await waToIncoming(change.value, message, accessToken))
      }
    }
    return new Response("EVENT_RECEIVED")
  },
  async send({ config, secrets, request, text, replyTo }) {
    const { phoneNumberId, accessToken } = creds(config, secrets)
    let context: { context: { message_id: string } } | undefined = replyTo?.externalId ? { context: { message_id: replyTo.externalId } } : undefined
    let last: { messages?: { id: string }[] } = {}
    for (const part of chunkText(text, 4000)) {
      last = await fetchJson(`${GRAPH}/${phoneNumberId}/messages`, {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
        body: JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", to: request.replyTo, type: "text", text: { body: part }, ...context }),
      })
      context = undefined
    }
    return { externalId: last.messages?.[0]?.id }
  },
}
