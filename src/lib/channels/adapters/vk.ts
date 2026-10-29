import { randomInt } from "node:crypto"
import type { Attachment } from "@/db/schema"
import { downloadToStorage, readStoredFile } from "@/lib/storage"
import { ChannelApiError, chunkText, fetchJson, greetingText } from "../http"
import { withQuote } from "../reply"
import type { AdapterContext, ChannelAdapter, IncomingMessage } from "../types"

const API_BASE = () => (process.env.VK_API_BASE ?? "https://api.vk.com/method").replace(/\/$/, "")
const V = "5.199"

type VkError = { error_code: number; error_msg: string }
type VkPhotoSize = { url: string; width: number; height: number; type: string }
type VkAttachment =
  | { type: "photo"; photo: { sizes: VkPhotoSize[] } }
  | { type: "doc"; doc: { url: string; title: string; ext?: string; size?: number } }
  | { type: "audio_message"; audio_message: { link_mp3?: string; link_ogg?: string } }
  | { type: "video"; video: { owner_id: number; id: number; title?: string } }
  | { type: "sticker"; sticker: unknown }
  | { type: "wall"; wall: { owner_id?: number; from_id?: number; id: number } }
  | { type: "link"; link: { url: string; title?: string } }
  | { type: string; [key: string]: unknown }
export type VkMessage = {
  id: number
  date: number
  peer_id: number
  from_id: number
  text: string
  conversation_message_id?: number
  payload?: string
  attachments?: VkAttachment[]
  geo?: { coordinates?: { latitude: number; longitude: number } }
  reply_message?: { conversation_message_id?: number; text?: string }
}

/** Тексты ошибок ВК, которые чаще всего видят при подключении. */
const VK_HINTS: Record<number, string> = {
  5: "Ключ доступа недействителен — создайте новый в «Работа с API».",
  15: "У ключа нет нужных прав — нужны «Сообщения сообщества» и «Управление сообществом».",
  27: "Ключ сообщества не подходит для этого метода.",
  100: "Неверный ID сообщества.",
  901: "Человек запретил сообщения от сообщества — ответить можно только после его нового сообщения.",
  917: "Нет доступа к беседе.",
}

async function vk<T>(method: string, token: string, params: Record<string, string | number>, signal?: AbortSignal) {
  const body = new URLSearchParams({ ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])), access_token: token, v: V })
  const res = await fetchJson<{ response?: T; error?: VkError }>(`${API_BASE()}/${method}`, { method: "POST", body, signal })
  if (res.error) {
    const hint = VK_HINTS[res.error.error_code]
    throw new ChannelApiError(hint ?? `ВК: ${res.error.error_msg}`, ![5, 15, 27, 100].includes(res.error.error_code))
  }
  return res.response as T
}

function creds(ctx: { config: Record<string, unknown>; secrets: Record<string, string> }) {
  const groupId = String(ctx.config.groupId ?? "").replace(/\D/g, "")
  if (!groupId) throw new ChannelApiError("Не указан ID сообщества", false)
  if (!ctx.secrets.token) throw new ChannelApiError("Не указан ключ доступа сообщества", false)
  return { groupId, token: ctx.secrets.token }
}

type VkUser = { id: number; first_name: string; last_name: string; screen_name?: string; photo_100?: string }
const userCache = new Map<number, VkUser>()

async function userInfo(token: string, id: number): Promise<VkUser | null> {
  if (id < 0) return null
  const hit = userCache.get(id)
  if (hit) return hit
  try {
    const [user] = await vk<VkUser[]>("users.get", token, { user_ids: id, fields: "screen_name,photo_100" })
    if (user) userCache.set(id, user)
    return user ?? null
  } catch {
    return null
  }
}

async function attachmentsOf(message: VkMessage): Promise<{ files: Attachment[]; notes: string[] }> {
  const files: Attachment[] = []
  const notes: string[] = []
  for (const a of message.attachments ?? []) {
    if (a.type === "photo" && "photo" in a) {
      const sizes = (a.photo as { sizes: VkPhotoSize[] }).sizes
      const best = [...sizes].sort((x, y) => y.width * y.height - x.width * x.height)[0]
      if (best) files.push(await downloadToStorage(best.url, "photo.jpg"))
    } else if (a.type === "doc" && "doc" in a) {
      const doc = a.doc as { url: string; title: string }
      files.push(await downloadToStorage(doc.url, doc.title))
    } else if (a.type === "audio_message" && "audio_message" in a) {
      const voice = a.audio_message as { link_mp3?: string; link_ogg?: string }
      const url = voice.link_mp3 ?? voice.link_ogg
      if (url) files.push(await downloadToStorage(url, "voice.mp3"))
    } else if (a.type === "video" && "video" in a) {
      const video = a.video as { owner_id: number; id: number; title?: string }
      notes.push(`Видео: https://vk.com/video${video.owner_id}_${video.id}`)
    } else if (a.type === "wall" && "wall" in a) {
      const wall = a.wall as { owner_id?: number; from_id?: number; id: number }
      notes.push(`Запись: https://vk.com/wall${wall.owner_id ?? wall.from_id}_${wall.id}`)
    } else if (a.type === "link" && "link" in a) {
      notes.push(`Ссылка: ${(a.link as { url: string }).url}`)
    } else if (a.type === "sticker") {
      notes.push("[стикер]")
    }
  }
  return { files, notes }
}

function isStart(message: VkMessage) {
  if (message.payload) {
    try {
      return (JSON.parse(message.payload) as { command?: string }).command === "start"
    } catch {
      return false
    }
  }
  return false
}

export async function vkToIncoming(token: string, message: VkMessage): Promise<IncomingMessage> {
  const user = await userInfo(token, message.from_id)
  const { files, notes } = await attachmentsOf(message)
  let text = [message.text, ...notes].filter(Boolean).join("\n")
  const geo = message.geo?.coordinates
  if (geo) text = `${text}\nГеолокация: https://yandex.ru/maps/?pt=${geo.longitude},${geo.latitude}&z=16`.trim()
  return {
    externalUserId: String(message.from_id),
    replyTo: String(message.peer_id),
    name: user ? `${user.first_name} ${user.last_name}`.trim() : undefined,
    handle: user?.screen_name,
    profileUrl: `https://vk.com/id${message.from_id}`,
    avatarUrl: user?.photo_100,
    text,
    attachments: files,
    externalMessageId: `${message.peer_id}:${message.conversation_message_id ?? message.id}`,
    receivedAt: new Date(message.date * 1000),
    meta: message.reply_message
      ? {
          replyToExternalId: message.reply_message.conversation_message_id ? `${message.peer_id}:${message.reply_message.conversation_message_id}` : undefined,
          replyToText: message.reply_message.text ?? "",
        }
      : undefined,
  }
}

async function handleMessage(ctx: AdapterContext, token: string, message: VkMessage) {
  // Беседы с несколькими участниками не берём — только личные сообщения сообществу.
  if (message.peer_id >= 2_000_000_000 || message.from_id < 0) return
  if (isStart(message)) {
    await vk("messages.send", token, { peer_id: message.peer_id, random_id: randomInt(2 ** 31 - 1), message: greetingText(ctx.config) })
    return
  }
  await ctx.ingest(await vkToIncoming(token, message))
}

type LpServer = { key: string; server: string; ts: string }

export const vkAdapter: ChannelAdapter = {
  kind: "vk",

  async test(ctx) {
    const { groupId, token } = creds(ctx)
    const res = await vk<{ groups: { name: string; screen_name: string }[] }>("groups.getById", token, { group_id: groupId })
    const group = res.groups?.[0]
    await vk<LpServer>("groups.getLongPollServer", token, { group_id: groupId })
    return `Сообщество «${group?.name ?? groupId}» (vk.com/${group?.screen_name ?? `club${groupId}`})`
  },

  async run(ctx) {
    const { groupId, token } = creds(ctx)
    let lp = await vk<LpServer>("groups.getLongPollServer", token, { group_id: groupId }, ctx.signal)
    let ts = String(ctx.config._ts ?? lp.ts)
    await ctx.setStatus("ok", "Получаем сообщения сообщества (Long Poll)")
    while (!ctx.signal.aborted) {
      const url = `${lp.server}?act=a_check&key=${encodeURIComponent(lp.key)}&ts=${encodeURIComponent(ts)}&wait=25`
      type LpResponse = { ts?: string; updates?: { type: string; object: { message?: VkMessage } }[]; failed?: number }
      const res = await fetchJson<LpResponse>(url, { signal: ctx.signal, timeoutMs: 40_000 }).catch((err): LpResponse => {
        if (ctx.signal.aborted) return { updates: [] }
        throw err
      })
      if (res.failed === 1 && res.ts) {
        ts = String(res.ts) // часть событий потеряна — продолжаем с нового номера
        continue
      }
      if (res.failed === 2 || res.failed === 3) {
        lp = await vk<LpServer>("groups.getLongPollServer", token, { group_id: groupId }, ctx.signal)
        if (res.failed === 3) ts = lp.ts
        continue
      }
      for (const update of res.updates ?? []) {
        if (update.type === "message_new" && update.object.message) await handleMessage(ctx, token, update.object.message)
      }
      if (res.ts) {
        ts = String(res.ts)
        await ctx.saveState({ _ts: ts })
      }
    }
  },

  async send({ config, secrets, request, text: rawText, attachments, replyTo }) {
    const { token } = creds({ config, secrets })
    const peerId = request.replyTo
    // Ответ на входящее — родной ответ ВК (по номеру сообщения в беседе); на своё — цитатой в тексте.
    const cmid = replyTo?.direction === "in" ? replyTo.externalId?.match(/^-?\d+:(\d+)$/)?.[1] : undefined
    const text = replyTo && !cmid ? withQuote(rawText, replyTo) : rawText
    let forward: Record<string, string> | undefined = cmid
      ? { forward: JSON.stringify({ peer_id: Number(peerId), conversation_message_ids: [Number(cmid)], is_reply: true }) }
      : undefined
    const uploaded: string[] = []
    for (const file of attachments) {
      const stored = await readStoredFile(file.url.split("/").pop() ?? "")
      if (!stored) continue
      const server = await vk<{ upload_url: string }>("docs.getMessagesUploadServer", token, { type: "doc", peer_id: peerId })
      const form = new FormData()
      form.set("file", new Blob([new Uint8Array(stored.data)], { type: stored.mime }), stored.name)
      const up = await fetchJson<{ file?: string; error?: string }>(server.upload_url, { method: "POST", body: form, timeoutMs: 60_000 })
      if (!up.file) throw new ChannelApiError(`ВК не принял файл ${stored.name}`)
      const saved = await vk<{ type: string; doc: { owner_id: number; id: number } }>("docs.save", token, { file: up.file, title: stored.name })
      uploaded.push(`doc${saved.doc.owner_id}_${saved.doc.id}`)
    }
    const parts = text ? chunkText(text, 4000) : [""]
    let lastId: number | undefined
    for (let i = 0; i < parts.length; i++) {
      const isLast = i === parts.length - 1
      lastId = await vk<number>("messages.send", token, {
        peer_id: peerId,
        random_id: randomInt(2 ** 31 - 1),
        message: parts[i],
        ...forward,
        ...(isLast && uploaded.length ? { attachment: uploaded.join(",") } : {}),
      })
      forward = undefined
    }
    return { externalId: lastId ? `out:${peerId}:${lastId}` : undefined }
  },
}
