import { eq, sql } from "drizzle-orm"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { db, pool, t } from "@/db"
import type { Channel } from "@/db/schema"
import { runMigrations } from "@/db/migrate"
import { ingestIncoming, REOPEN_WINDOW_MS } from "@/lib/channels/ingest"

let vk: Channel
let mail: Channel

beforeAll(async () => {
  await runMigrations()
})
afterAll(async () => {
  await pool.end()
})
beforeEach(async () => {
  await db.execute(sql`truncate messages, requests, contact_identities, contacts, channels restart identity cascade`)
  ;[vk] = await db.insert(t.channels).values({ kind: "vk", name: "ВК" }).returning()
  ;[mail] = await db.insert(t.channels).values({ kind: "email", name: "Почта" }).returning()
})

const vkMsg = (text: string, id: string, extra = {}) => ({ externalUserId: "100", replyTo: "100", name: "Ольга", text, externalMessageId: id, ...extra })

describe("приём сообщений", () => {
  it("первое сообщение создаёт заявку и контакт, второе дописывается туда же", async () => {
    const a = await ingestIncoming(vk, vkMsg("Здравствуйте", "1"))
    const b = await ingestIncoming(vk, vkMsg("Нужна сиделка", "2"))
    expect(a?.createdRequest).toBe(true)
    expect(b?.createdRequest).toBe(false)
    expect(b?.requestId).toBe(a?.requestId)
    const [req] = await db.select().from(t.requests)
    expect(req.unread).toBe(2)
    expect(req.lastMessagePreview).toBe("Нужна сиделка")
  })

  it("повторная доставка того же сообщения не создаёт дубль", async () => {
    await ingestIncoming(vk, vkMsg("Привет", "same"))
    expect(await ingestIncoming(vk, vkMsg("Привет", "same"))).toBeNull()
    const rows = await db.select().from(t.messages)
    expect(rows).toHaveLength(1)
  })

  it("одновременная двойная доставка тоже не создаёт дубль", async () => {
    await Promise.all([ingestIncoming(vk, vkMsg("Гонка", "race")), ingestIncoming(vk, vkMsg("Гонка", "race"))])
    expect(await db.select().from(t.messages)).toHaveLength(1)
  })

  it("человек из почты и ВК с одной почтой — один контакт, история общая", async () => {
    await ingestIncoming(vk, vkMsg("Пишу в ВК", "v1", { email: "olga@mail.ru" }))
    await ingestIncoming(mail, { externalUserId: "olga@mail.ru", replyTo: "olga@mail.ru", email: "OLGA@mail.ru", name: "Ольга", text: "И письмом", externalMessageId: "<m1>" })
    expect(await db.select().from(t.contacts)).toHaveLength(1)
    expect(await db.select().from(t.contactIdentities)).toHaveLength(2)
    expect(await db.select().from(t.requests)).toHaveLength(2) // каналы разные — заявки разные, человек один
  })

  it("недавно решённая заявка открывается снова, давно решённая — заводится новая", async () => {
    const first = await ingestIncoming(vk, vkMsg("Вопрос", "r1"))
    await db.update(t.requests).set({ status: "resolved", resolvedAt: new Date() }).where(eq(t.requests.id, first!.requestId))
    const again = await ingestIncoming(vk, vkMsg("Ещё вопрос", "r2"))
    expect(again?.requestId).toBe(first?.requestId)
    const [reopened] = await db.select().from(t.requests).where(eq(t.requests.id, first!.requestId))
    expect(reopened.status).toBe("open")
    expect(reopened.resolvedAt).toBeNull()

    await db
      .update(t.requests)
      .set({ status: "resolved", resolvedAt: new Date(Date.now() - REOPEN_WINDOW_MS - 60_000) })
      .where(eq(t.requests.id, first!.requestId))
    const fresh = await ingestIncoming(vk, vkMsg("Новая тема через неделю", "r3"))
    expect(fresh?.createdRequest).toBe(true)
    expect(fresh?.requestId).not.toBe(first?.requestId)
  })

  it("ответ на письмо фонда попадает в свою заявку по In-Reply-To, даже если у человека их несколько", async () => {
    const one = await ingestIncoming(mail, { externalUserId: "a@b.ru", replyTo: "a@b.ru", email: "a@b.ru", text: "Первая тема", externalMessageId: "<t1>", meta: { messageId: "<t1>" } })
    await db.update(t.requests).set({ status: "resolved", resolvedAt: new Date(Date.now() - REOPEN_WINDOW_MS * 2) }).where(eq(t.requests.id, one!.requestId))
    const two = await ingestIncoming(mail, { externalUserId: "a@b.ru", replyTo: "a@b.ru", email: "a@b.ru", text: "Вторая тема", externalMessageId: "<t2>", meta: { messageId: "<t2>" } })
    expect(two?.createdRequest).toBe(true)
    const reply = await ingestIncoming(mail, { externalUserId: "a@b.ru", replyTo: "a@b.ru", email: "a@b.ru", text: "Про первую", externalMessageId: "<t3>", threadKeys: ["<t1>"] })
    expect(reply?.requestId).toBe(one?.requestId)
  })

  it("ответ человека переводит заявку из «Ждём ответа» в работу", async () => {
    const first = await ingestIncoming(vk, vkMsg("Вопрос", "w1"))
    await db.update(t.requests).set({ status: "waiting" }).where(eq(t.requests.id, first!.requestId))
    await ingestIncoming(vk, vkMsg("Ответ человека", "w2"))
    const [req] = await db.select().from(t.requests)
    expect(req.status).toBe("open")
  })

  it("пустое сообщение без файлов игнорируется", async () => {
    expect(await ingestIncoming(vk, vkMsg("   ", "e1"))).toBeNull()
  })
})
