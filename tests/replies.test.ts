import http from "node:http"
import type { AddressInfo } from "node:net"
import { eq, sql } from "drizzle-orm"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { db, pool, t } from "@/db"
import { runMigrations } from "@/db/migrate"
import { GET as getRequest } from "@/app/api/requests/[id]/route"
import { telegramToIncoming } from "@/lib/channels/adapters/telegram"
import { vkToIncoming } from "@/lib/channels/adapters/vk"
import { ingestIncoming } from "@/lib/channels/ingest"
import { sendReply } from "@/lib/channels/outbound"
import { withQuote } from "@/lib/channels/reply"
import { encryptJson } from "@/lib/crypto"
import type { RequestDetail } from "@/lib/api-types"

/** Ответы на конкретные сообщения и смайлики: от кнопки «Ответить» до API площадки. */

type Call = { path: string; query: URLSearchParams; body: string }

async function fakeApi(handler: (call: Call) => unknown) {
  const calls: Call[] = []
  const server = http.createServer(async (req, res) => {
    const chunks: Buffer[] = []
    for await (const c of req) chunks.push(c as Buffer)
    const url = new URL(req.url ?? "/", "http://x")
    const call = { path: url.pathname, query: url.searchParams, body: Buffer.concat(chunks).toString() }
    calls.push(call)
    res.setHeader("content-type", "application/json")
    res.end(JSON.stringify(await handler(call)))
  })
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r))
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, calls, close: () => new Promise<void>((r) => server.close(() => r())) }
}

async function channelOf(kind: string, secrets: Record<string, string>, config: Record<string, unknown> = {}) {
  const [channel] = await db.insert(t.channels).values({ kind, name: kind, enabled: true, config, secrets: encryptJson(secrets) }).returning()
  return channel
}

async function detail(id: string) {
  const res = await getRequest(new Request(`http://x/api/requests/${id}`), { params: Promise.resolve({ id }) } as never)
  return (await res.json()) as RequestDetail
}

let agentId = ""
beforeAll(async () => {
  await runMigrations()
})
afterAll(async () => {
  await pool.end()
})
beforeEach(async () => {
  await db.execute(sql`truncate messages, requests, contact_identities, contacts, channels, sessions, users restart identity cascade`)
  const [u] = await db.insert(t.users).values({ email: "maria@dom.local", name: "Мария", passwordHash: "x" }).returning()
  agentId = u.id
})

// Ручка карточки проверяет вход — в тесте подставляем сессию сотрудника.
import { vi } from "vitest"
vi.mock("@/lib/auth", async (orig) => {
  const mod = await orig<typeof import("@/lib/auth")>()
  return { ...mod, api: (fn: (...a: unknown[]) => unknown) => async (req: Request, ctx: unknown) => Response.json(await fn(req, ctx, { id: agentId, role: "admin", name: "Мария" })) }
})

describe("ответ на сообщение", () => {
  it("Telegram: родной ответ на конкретное сообщение, смайлики доходят как есть", async () => {
    const api = await fakeApi(({ path }) => (path.endsWith("/sendMessage") ? { ok: true, result: { message_id: 901 } } : { ok: true, result: {} }))
    process.env.TELEGRAM_API_BASE = api.url
    const channel = await channelOf("telegram", { botToken: "1:a" })
    const from = { id: 42, first_name: "Анна" }
    const first = await ingestIncoming(channel, (await telegramToIncoming("1:a", { message_id: 5, date: 1_800_000_000, chat: { id: 42, type: "private" }, from, text: "Нашла кота у подъезда" }))!)
    await ingestIncoming(channel, (await telegramToIncoming("1:a", { message_id: 6, date: 1_800_000_001, chat: { id: 42, type: "private" }, from, text: "Он хромает" }))!)
    const [quoted] = await db.select().from(t.messages).where(eq(t.messages.externalId, "42:5"))

    const reply = await sendReply({ requestId: first!.requestId, text: "Спасибо 🙏 Едем! 🐈🐾", replyToId: quoted.id, author: { type: "agent", userId: agentId } })
    expect(reply.delivery).toBe("sent")
    const body = JSON.parse(api.calls.at(-1)!.body)
    expect(body).toMatchObject({ chat_id: "42", text: "Спасибо 🙏 Едем! 🐈🐾", reply_parameters: { message_id: 5, allow_sending_without_reply: true } })
    expect(reply.meta).toMatchObject({ replyTo: { id: quoted.id, text: "Нашла кота у подъезда" } })

    // Человек отвечает на наше сообщение — в карточке видна цитата со ссылкой на него.
    await ingestIncoming(
      channel,
      (await telegramToIncoming("1:a", { message_id: 7, date: 1_800_000_002, chat: { id: 42, type: "private" }, from, text: "Ждём 😊", reply_to_message: { message_id: 901, text: "Спасибо 🙏 Едем! 🐈🐾" } }))!,
    )
    const d = await detail(first!.requestId)
    const ours = d.messages.find((m) => m.direction === "out")!
    expect(ours.replyTo).toEqual({ id: quoted.id, text: "Нашла кота у подъезда" })
    const answer = d.messages.find((m) => m.text === "Ждём 😊")!
    expect(answer.replyTo).toEqual({ id: ours.id, text: "Спасибо 🙏 Едем! 🐈🐾" })
    await api.close()
  })

  it("ВК: ответ на входящее — через forward с is_reply, на своё — цитатой в тексте", async () => {
    const api = await fakeApi(({ path }) => {
      if (path === "/method/users.get") return { response: [{ id: 100, first_name: "Ольга", last_name: "С" }] }
      if (path === "/method/messages.send") return { response: 555 + api.calls.length }
      return { response: {} }
    })
    process.env.VK_API_BASE = `${api.url}/method`
    const channel = await channelOf("vk", { token: "vk1" }, { groupId: "1" })
    const inc = await ingestIncoming(channel, await vkToIncoming("vk1", { id: 1, date: 1_800_000_000, peer_id: 100, from_id: 100, text: "Можно взять Барса?", conversation_message_id: 9 }))
    const [quoted] = await db.select().from(t.messages).where(eq(t.messages.direction, "in"))
    const out = await sendReply({ requestId: inc!.requestId, text: "Конечно 😊", replyToId: quoted.id, author: { type: "agent", userId: agentId } })
    let params = new URLSearchParams(api.calls.at(-1)!.body)
    expect(params.get("message")).toBe("Конечно 😊")
    expect(JSON.parse(params.get("forward")!)).toEqual({ peer_id: 100, conversation_message_ids: [9], is_reply: true })

    await sendReply({ requestId: inc!.requestId, text: "И ещё вопрос", replyToId: out.id, author: { type: "agent", userId: agentId } })
    params = new URLSearchParams(api.calls.at(-1)!.body)
    expect(params.get("forward")).toBeNull()
    expect(params.get("message")).toBe("«Конечно 😊»\n\nИ ещё вопрос")

    // Входящий ответ из ВК находит исходное сообщение по номеру в беседе.
    await ingestIncoming(channel, await vkToIncoming("vk1", { id: 3, date: 1_800_000_009, peer_id: 100, from_id: 100, text: "Спасибо!", conversation_message_id: 12, reply_message: { conversation_message_id: 9, text: "Можно взять Барса?" } }))
    const d = await detail(inc!.requestId)
    expect(d.messages.find((m) => m.text === "Спасибо!")!.replyTo).toEqual({ id: quoted.id, text: "Можно взять Барса?" })
    await api.close()
  })

  it("MAX: ответ ссылкой reply на mid", async () => {
    const api = await fakeApi(() => ({ message: { body: { mid: "out.1" } } }))
    process.env.MAX_API_BASE = api.url
    const channel = await channelOf("max", { token: "mx" })
    const [contact] = await db.insert(t.contacts).values({ name: "Сергей" }).returning()
    const [request] = await db.insert(t.requests).values({ channelId: channel.id, contactId: contact.id, replyTo: "chat:300" }).returning()
    const [quoted] = await db.insert(t.messages).values({ requestId: request.id, channelId: channel.id, direction: "in", authorType: "contact", text: "Хотим помочь", externalId: "m.1" }).returning()
    await sendReply({ requestId: request.id, text: "Ура 🎉", replyToId: quoted.id, author: { type: "agent", userId: agentId } })
    expect(JSON.parse(api.calls.at(-1)!.body)).toEqual({ text: "Ура 🎉", link: { type: "reply", mid: "m.1" } })
    await api.close()
  })

  it("заметка-ответ видна только сотрудникам; чужое сообщение — отказ", async () => {
    const channel = await channelOf("manual", {})
    const [contact] = await db.insert(t.contacts).values({ name: "Звонок" }).returning()
    const [request] = await db.insert(t.requests).values({ channelId: channel.id, contactId: contact.id, replyTo: "-" }).returning()
    const [other] = await db.insert(t.requests).values({ channelId: channel.id, contactId: contact.id, replyTo: "-" }).returning()
    const [m] = await db.insert(t.messages).values({ requestId: request.id, direction: "in", authorType: "contact", text: "Звонила, нашла щенков" }).returning()
    const note = await sendReply({ requestId: request.id, text: "Беру 👍", internal: true, replyToId: m.id, author: { type: "agent", userId: agentId } })
    expect(note.direction).toBe("internal")
    expect(note.meta).toMatchObject({ replyTo: { id: m.id } })
    await expect(sendReply({ requestId: other.id, text: "x", replyToId: m.id, internal: true, author: { type: "agent", userId: agentId } })).rejects.toThrow(/не найдено/)
  })

  it("почта и площадки без родных ответов получают цитату", () => {
    const msg = { text: "Котята в подвале\nдом 5", attachments: [] } as never
    expect(withQuote("Едем", msg, "mail")).toBe("Едем\n\n> Котята в подвале\n> дом 5")
    expect(withQuote("Едем", msg)).toBe("«Котята в подвале дом 5»\n\nЕдем")
  })
})
