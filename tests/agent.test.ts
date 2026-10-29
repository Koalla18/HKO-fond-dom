import http from "node:http"
import type { AddressInfo } from "node:net"
import { eq, sql } from "drizzle-orm"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { db, pool, t } from "@/db"
import type { Channel } from "@/db/schema"
import { runMigrations } from "@/db/migrate"
import { agentIdle, notifyAgent, runAgentNow } from "@/lib/agent"
import { parseModelAnswer, redact } from "@/lib/agent/llm"
import { ingestIncoming } from "@/lib/channels/ingest"
import { encryptJson } from "@/lib/crypto"
import { setSetting } from "@/lib/settings"

/** Поддельная модель: отвечает заранее заданным JSON и запоминает, что ей прислали. */
let answer: unknown = {}
const calls: { auth: string; body: { model: string; messages: { role: string; content: string }[] } }[] = []
const server = http.createServer(async (req, res) => {
  const chunks: Buffer[] = []
  for await (const c of req) chunks.push(c as Buffer)
  calls.push({ auth: String(req.headers.authorization), body: JSON.parse(Buffer.concat(chunks).toString()) })
  res.setHeader("content-type", "application/json")
  res.end(JSON.stringify({ choices: [{ message: { content: "```json\n" + JSON.stringify(answer) + "\n```" } }] }))
})
let widget: Channel

/** Обращение без участия ассистента: как будто пришло, пока он был выключен. */
async function quietRequest(text: string, extra: Partial<typeof t.requests.$inferInsert> = {}) {
  const [contact] = await db.insert(t.contacts).values({ name: "Посетитель" }).returning()
  const [request] = await db.insert(t.requests).values({ channelId: widget.id, contactId: contact.id, replyTo: "visitor:x", lastMessageDirection: "in", ...extra }).returning()
  const [message] = await db.insert(t.messages).values({ requestId: request.id, channelId: widget.id, direction: "in", authorType: "contact", text }).returning()
  return { requestId: request.id, messageId: message.id }
}

beforeAll(async () => {
  await runMigrations()
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r))
})
afterAll(async () => {
  server.close()
  await pool.end()
})
beforeEach(async () => {
  calls.length = 0
  await db.execute(sql`truncate application_events, applications, messages, requests, contact_identities, contacts, channels, settings restart identity cascade`)
  ;[widget] = await db.insert(t.channels).values({ kind: "widget", name: "Чат на сайте", enabled: true }).returning()
  const port = (server.address() as AddressInfo).port
  await setSetting("ai", { enabled: true, provider: "deepseek", baseUrl: `http://127.0.0.1:${port}/v1`, model: "test-model", autoReply: true, createApplications: true })
  await setSetting("aiKey", { enc: encryptJson({ key: "sk-test-1234" }) })
})

const FOUND = {
  reply: "Спасибо, что не прошли мимо! Пришлите, пожалуйста, фото и точное место.",
  category: "Нашли животное",
  priority: "urgent",
  subject: "Сбитая собака у остановки",
  summary: "Собаку сбили на Новом бульваре, не встаёт на заднюю лапу.",
  application: { kind: "found", fields: { species: "Собака", condition: ["Ранен или хромает"], address: "Долгопрудный, Новый бульвар", hack: "x" }, urgent: true },
  handoff: null,
  note: null,
}

describe("ассистент", () => {
  it("новое обращение: разбирает, оформляет заявку и отвечает человеку", async () => {
    answer = FOUND
    // Ассистента зовёт сам приём сообщения — как в бою.
    await ingestIncoming(widget, { externalUserId: "visitor:1", replyTo: "visitor:1", text: "Сбили собаку на Новом бульваре, звоните +7 926 111-22-33" })
    await agentIdle()

    expect(calls[0].auth).toBe("Bearer sk-test-1234")
    expect(calls[0].body.model).toBe("test-model")
    // DeepSeek за рубежом — телефон в переписке не уходит.
    expect(calls[0].body.messages.at(-1)?.content).toContain("[телефон]")
    expect(calls[0].body.messages[0].content).toContain("found «Нашли животное»")

    const [app] = await db.select().from(t.applications)
    expect(app.source).toBe("ai")
    expect(app.urgent).toBe(true)
    expect(app.fields).toEqual({ species: "Собака", condition: ["Ранен или хромает"], address: "Долгопрудный, Новый бульвар" })
    const [req] = await db.select().from(t.requests)
    expect(req.priority).toBe("urgent")
    expect(req.subject).toBe("Сбитая собака у остановки")
    const out = await db.select().from(t.messages).where(eq(t.messages.direction, "out"))
    expect(out).toHaveLength(1)
    expect(out[0].authorType).toBe("ai")
    expect(out[0].text.startsWith("Ассистент фонда «ДОМ»:")).toBe(true)
  })

  it("обращение ведёт сотрудник: ассистент молча дополняет заявку, человеку не пишет и категорию не трогает", async () => {
    answer = FOUND
    const inc = await quietRequest("Сбили собаку", { aiHandling: false, category: "Срочная ветпомощь" })
    void notifyAgent({ requestId: inc!.requestId, messageId: inc!.messageId, createdRequest: false })
    void notifyAgent({ requestId: inc!.requestId, messageId: inc!.messageId, createdRequest: false })
    await agentIdle()
    expect(await db.select().from(t.applications)).toHaveLength(1) // повторный разбор — та же заявка
    expect(await db.select().from(t.messages).where(eq(t.messages.direction, "out"))).toHaveLength(0)
    const [req] = await db.select().from(t.requests)
    expect(req.category).toBe("Срочная ветпомощь")
    expect(req.priority).toBe("urgent")
  })

  it("«Разобрать ассистентом» вручную и выключенный ассистент", async () => {
    answer = { ...FOUND, application: { kind: "adopt", fields: { animal: "Барс", region: "Москва" } } }
    const inc = await quietRequest("Хочу взять Барса")
    await runAgentNow(inc!.requestId)
    const [app] = await db.select().from(t.applications)
    expect(app.kind).toBe("adopt")
    expect(app.title).toBe("Хочет взять Барс")

    await setSetting("ai", { enabled: false })
    calls.length = 0
    await notifyAgent({ requestId: inc!.requestId, messageId: inc!.messageId, createdRequest: false })
    expect(calls).toHaveLength(0)
  })

  it("разбор ответа модели и обезличивание", () => {
    expect(parseModelAnswer("Вот ответ: {\"category\": \"Опека\", \"application\": null}")?.category).toBe("Опека")
    expect(parseModelAnswer("не JSON")).toBeNull()
    expect(redact("пишите ivan@mail.ru или 8 (926) 111-22-33")).toBe("пишите [почта] или [телефон]")
  })
})
