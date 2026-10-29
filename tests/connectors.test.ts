import http from "node:http"
import type { AddressInfo } from "node:net"
import { eq, sql } from "drizzle-orm"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { db, pool, t } from "@/db"
import { runMigrations } from "@/db/migrate"
import { maxAdapter } from "@/lib/channels/adapters/max"
import { telegramAdapter } from "@/lib/channels/adapters/telegram"
import { vkAdapter } from "@/lib/channels/adapters/vk"
import { makeContext } from "@/lib/channels/manager"
import { sendReply } from "@/lib/channels/outbound"
import { encryptJson } from "@/lib/crypto"

/**
 * Коннекторы против локальных «двойников» API площадок: тот же код опроса и
 * отправки, что в бою, только адрес API подменён на тестовый сервер.
 */

type Call = { method: string; path: string; query: URLSearchParams; body: string; headers: http.IncomingHttpHeaders }
type Handler = (call: Call) => Promise<unknown> | unknown

async function fakeApi(handler: Handler) {
  const calls: Call[] = []
  const server = http.createServer(async (req, res) => {
    const chunks: Buffer[] = []
    for await (const c of req) chunks.push(c as Buffer)
    const url = new URL(req.url ?? "/", "http://x")
    const call = { method: req.method ?? "GET", path: url.pathname, query: url.searchParams, body: Buffer.concat(chunks).toString(), headers: req.headers }
    calls.push(call)
    const data = await handler(call)
    res.setHeader("content-type", "application/json")
    res.end(JSON.stringify(data))
  })
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r))
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  return { url, calls, close: () => new Promise<void>((r) => server.close(() => r())) }
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
async function until(cond: () => Promise<boolean> | boolean, ms = 5000) {
  const end = Date.now() + ms
  while (Date.now() < end) {
    if (await cond()) return
    await wait(50)
  }
  throw new Error("не дождались")
}

async function makeChannel(kind: string, config: Record<string, unknown>, secrets: Record<string, string>) {
  const [channel] = await db.insert(t.channels).values({ kind, name: kind, enabled: true, config, secrets: encryptJson(secrets) }).returning()
  return channel
}

beforeAll(async () => {
  await runMigrations()
})
afterAll(async () => {
  await pool.end()
})
beforeEach(async () => {
  await db.execute(sql`truncate messages, requests, contact_identities, contacts, channels restart identity cascade`)
})

describe("Telegram", () => {
  it("опрос: /start получает приветствие, сообщение становится заявкой, ответ уходит в чат", async () => {
    let served = false
    const api = await fakeApi(async ({ path, body }) => {
      const method = path.split("/").pop()
      if (method === "getMe") return { ok: true, result: { username: "fond_dom_bot", first_name: "Фонд" } }
      if (method === "deleteWebhook") return { ok: true, result: true }
      if (method === "sendMessage") return { ok: true, result: { message_id: 900 } }
      if (method === "getUpdates") {
        if (served) {
          await wait(100)
          return { ok: true, result: [] }
        }
        served = true
        const from = { id: 42, first_name: "Анна", username: "anna" }
        return {
          ok: true,
          result: [
            { update_id: 10, message: { message_id: 1, date: 1_800_000_000, chat: { id: 42, type: "private" }, from, text: "/start" } },
            { update_id: 11, message: { message_id: 2, date: 1_800_000_001, chat: { id: 42, type: "private" }, from, text: "Нужна помощь с лекарствами" } },
            { update_id: 12, message: { message_id: 3, date: 1_800_000_002, chat: { id: -5, type: "group" }, from, text: "из группы" } },
          ],
        }
      }
      return { ok: false, description: `unknown ${method} ${body}` }
    })
    process.env.TELEGRAM_API_BASE = api.url
    const channel = await makeChannel("telegram", { mode: "polling" }, { botToken: "123:abc" })
    const controller = new AbortController()
    const running = telegramAdapter.run!(makeContext(channel, controller.signal))

    await until(async () => (await db.select().from(t.requests)).length === 1)
    controller.abort()
    await running

    const greeting = api.calls.find((c) => c.path.endsWith("/sendMessage"))
    expect(JSON.parse(greeting!.body)).toMatchObject({ chat_id: 42 })
    const [request] = await db.select().from(t.requests)
    const [contact] = await db.select().from(t.contacts)
    expect(contact.name).toBe("Анна")
    expect(request.lastMessagePreview).toBe("Нужна помощь с лекарствами")
    const [saved] = await db.select().from(t.channels).where(eq(t.channels.id, channel.id))
    expect(saved.config._offset).toBe(13) // курсор пережил перезапуск, групповой чат пропущен
    expect(await db.select().from(t.messages)).toHaveLength(1)

    const reply = await sendReply({ requestId: request.id, text: "Анна, здравствуйте! Подскажите город.", author: { type: "system" } })
    expect(reply.delivery).toBe("sent")
    const sent = api.calls.filter((c) => c.path.endsWith("/sendMessage")).at(-1)!
    expect(JSON.parse(sent.body)).toEqual({ chat_id: "42", text: "Анна, здравствуйте! Подскажите город." })
    await api.close()
  })
})

describe("ВКонтакте", () => {
  it("Long Poll: потеря событий и смена ключа переживаются, ответ уходит через messages.send", async () => {
    let lp = 0
    const api = await fakeApi(async ({ path, body, query }) => {
      const params = new URLSearchParams(body)
      if (path === "/method/groups.getLongPollServer") return { response: { key: `k${lp}`, server: `${api.url}/lp`, ts: "1" } }
      if (path === "/method/users.get") return { response: [{ id: 100, first_name: "Ольга", last_name: "Смирнова", screen_name: "olga" }] }
      if (path === "/method/messages.send") return { response: 555, params: Object.fromEntries(params) }
      if (path === "/lp") {
        lp++
        if (lp === 1) return { failed: 2 } // ключ устарел — адаптер должен перезапросить сервер
        if (lp === 2) {
          expect(query.get("key")).toBe("k1")
          return {
            ts: "2",
            updates: [
              { type: "message_new", object: { message: { id: 1, date: 1_800_000_000, peer_id: 100, from_id: 100, text: "Здравствуйте", conversation_message_id: 7 } } },
              { type: "message_new", object: { message: { id: 2, date: 1_800_000_000, peer_id: 2_000_000_001, from_id: 100, text: "беседа" } } },
            ],
          }
        }
        await wait(100)
        return { ts: "2", updates: [] }
      }
      return { error: { error_code: 3, error_msg: `unknown ${path}` } }
    })
    process.env.VK_API_BASE = `${api.url}/method`
    const channel = await makeChannel("vk", { groupId: "777" }, { token: "vk1.a.test" })
    const controller = new AbortController()
    const running = vkAdapter.run!(makeContext(channel, controller.signal))
    await until(async () => (await db.select().from(t.requests)).length === 1)
    controller.abort()
    await running

    const [contact] = await db.select().from(t.contacts)
    expect(contact.name).toBe("Ольга Смирнова")
    const [identity] = await db.select().from(t.contactIdentities)
    expect(identity.handle).toBe("olga")
    expect(await db.select().from(t.messages)).toHaveLength(1) // беседа пропущена

    const [request] = await db.select().from(t.requests)
    const reply = await sendReply({ requestId: request.id, text: "Ольга, добрый день!", author: { type: "system" } })
    expect(reply.delivery).toBe("sent")
    const sent = api.calls.find((c) => c.path === "/method/messages.send")!
    const params = new URLSearchParams(sent.body)
    expect(params.get("peer_id")).toBe("100")
    expect(params.get("message")).toBe("Ольга, добрый день!")
    expect(params.get("access_token")).toBe("vk1.a.test")
    await api.close()
  })

  it("неверный ключ: понятная причина в статусе отправки", async () => {
    const api = await fakeApi(() => ({ error: { error_code: 5, error_msg: "User authorization failed" } }))
    process.env.VK_API_BASE = `${api.url}/method`
    const channel = await makeChannel("vk", { groupId: "777" }, { token: "bad" })
    const [contact] = await db.insert(t.contacts).values({ name: "X" }).returning()
    const [request] = await db.insert(t.requests).values({ channelId: channel.id, contactId: contact.id, replyTo: "100" }).returning()
    const reply = await sendReply({ requestId: request.id, text: "привет", author: { type: "system" } })
    expect(reply.delivery).toBe("failed")
    expect(reply.deliveryError).toContain("Ключ доступа недействителен")
    await api.close()
  })
})

describe("MAX", () => {
  it("опрос с маркером, токен в заголовке, ответ в тот же диалог", async () => {
    let served = false
    const api = await fakeApi(async ({ path, method, query, headers }) => {
      expect(headers.authorization).toBe("max-token")
      if (path === "/me") return { user_id: 1, name: "Фонд Дом", username: "fond_dom_bot" }
      if (path === "/messages" && method === "POST") return { message: { body: { mid: `out.${query.get("chat_id")}` } } }
      if (path === "/updates") {
        if (served) {
          await wait(100)
          return { updates: [], marker: 5 }
        }
        served = true
        return {
          marker: 5,
          updates: [
            { update_type: "bot_started", timestamp: 1, chat_id: 300, user: { user_id: 7, name: "Сергей" } },
            {
              update_type: "message_created",
              timestamp: 1_800_000_000_000,
              message: { sender: { user_id: 7, name: "Сергей Козлов" }, recipient: { chat_id: 300, chat_type: "dialog" }, timestamp: 1_800_000_000_000, body: { mid: "m.1", text: "Хотим помочь" } },
            },
          ],
        }
      }
      return {}
    })
    process.env.MAX_API_BASE = api.url
    const channel = await makeChannel("max", {}, { token: "max-token" })
    const controller = new AbortController()
    const running = maxAdapter.run!(makeContext(channel, controller.signal))
    await until(async () => (await db.select().from(t.requests)).length === 1)
    controller.abort()
    await running

    const greeting = api.calls.find((c) => c.path === "/messages")!
    expect(greeting.query.get("chat_id")).toBe("300")
    const [request] = await db.select().from(t.requests)
    expect(request.replyTo).toBe("chat:300")
    const [saved] = await db.select().from(t.channels).where(eq(t.channels.id, channel.id))
    expect(saved.config._marker).toBe(5)

    const reply = await sendReply({ requestId: request.id, text: "Спасибо, Сергей!", author: { type: "system" } })
    expect(reply.delivery).toBe("sent")
    expect(reply.externalId).toBe("out.300")
    await api.close()
  })
})
