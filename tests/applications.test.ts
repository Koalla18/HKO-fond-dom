import { eq, sql } from "drizzle-orm"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { db, pool, t } from "@/db"
import type { Channel } from "@/db/schema"
import { runMigrations } from "@/db/migrate"
import { POST as submitForm } from "@/app/api/public/form/[channelId]/route"
import { animalLabel, applicationTitle, isUrgent, kindForCategory, validateFields } from "@/lib/applications/catalog"
import { assignApplication, createApplication, moveStage, updateApplication } from "@/lib/applications/service"
import { ingestIncoming } from "@/lib/channels/ingest"
import { loadDashboard } from "@/lib/dashboard"

let vk: Channel
let form: Channel
const agent = { type: "agent" as const, userId: "", name: "Мария" }

beforeAll(async () => {
  await runMigrations()
})
afterAll(async () => {
  await pool.end()
})
beforeEach(async () => {
  await db.execute(sql`truncate application_events, applications, messages, requests, contact_identities, contacts, channels, sessions, users restart identity cascade`)
  ;[vk] = await db.insert(t.channels).values({ kind: "vk", name: "ВК" }).returning()
  ;[form] = await db.insert(t.channels).values({ kind: "webform", name: "Формы сайта", enabled: true }).returning()
  const [user] = await db.insert(t.users).values({ email: "maria@dom.local", name: "Мария Котова", passwordHash: "x" }).returning()
  agent.userId = user.id
})

describe("каталог анкет", () => {
  it("строгая проверка требует обязательные поля и варианты из списка", () => {
    const empty = validateFields("found", {}, true)
    expect(Object.keys(empty.errors).sort()).toEqual(["address", "condition", "species"])
    const wrong = validateFields("found", { species: "Дракон", condition: ["Без мамы", "Чепуха"], address: "Долгопрудный" }, true)
    expect(wrong.errors.species).toBeTruthy()
    expect(wrong.fields.condition).toEqual(["Без мамы"])
  })

  it("черновик сотрудника принимается без обязательных полей, лишние ключи отбрасываются", () => {
    const draft = validateFields("adopt", { animal: "Барс", hack: "<script>", agreement: "on" }, false)
    expect(draft.errors).toEqual({})
    expect(draft.fields).toEqual({ animal: "Барс", agreement: true })
  })

  it("срочность, заголовок и вид по категории", () => {
    expect(isUrgent("found", { condition: ["Ранен или хромает"] })).toBe(true)
    expect(isUrgent("found", { condition: ["Здоров на вид"] })).toBe(false)
    expect(applicationTitle("adopt", { animal: "https://fundhome.ru/animal/1043" })).toBe("Хочет взять анкета №1043")
    expect(animalLabel("/animal/bars")).toBe("анкета «bars»")
    expect(kindForCategory("Хочу взять питомца")).toBe("adopt")
    expect(kindForCategory("Срочная ветпомощь")).toBe("found")
    expect(kindForCategory("Пожертвование")).toBeNull()
  })
})

describe("заявки", () => {
  it("оформление из обращения: история, заметка в переписке, категория и срочность обращения", async () => {
    const inc = await ingestIncoming(vk, { externalUserId: "1", replyTo: "1", name: "Ольга", text: "Во дворе сбили собаку" })
    const app = await createApplication({
      kind: "found",
      fields: { species: "Собака", condition: ["Ранен или хромает"], address: "Долгопрудный, Новый бульвар" },
      strict: false,
      source: "inbox",
      requestId: inc!.requestId,
      actor: agent,
    })
    expect(app.urgent).toBe(true)
    expect(app.title).toBe("Собака — Долгопрудный, Новый бульвар")
    const [req] = await db.select().from(t.requests).where(eq(t.requests.id, inc!.requestId))
    expect(req.category).toBe("Нашли животное")
    expect(req.priority).toBe("urgent")
    const notes = await db.select().from(t.messages).where(eq(t.messages.direction, "internal"))
    expect(notes.map((m) => m.text)).toContain(`Оформлена заявка №${app.number} «Нашли животное» — Мария`)
    expect(await db.select().from(t.applicationEvents)).toHaveLength(1)
  })

  it("этапы: итог ставит дату закрытия, возврат в работу её снимает", async () => {
    const app = await createApplication({ kind: "adopt", fields: { animal: "Барс" }, strict: false, source: "manual", person: { name: "Ирина", phone: "8 926 000-00-00" }, actor: agent })
    const done = await moveStage(app.id, "done", agent, "Барс уехал в Химки")
    expect(done.closedAt).not.toBeNull()
    expect(done.outcome).toBe("Барс уехал в Химки")
    const back = await moveStage(app.id, "review", agent)
    expect(back.closedAt).toBeNull()
    const events = await db.select().from(t.applicationEvents).where(eq(t.applicationEvents.applicationId, app.id))
    expect(events.map((e) => e.type)).toEqual(["created", "stage", "stage"])
    const [contact] = await db.select().from(t.contacts)
    expect(contact.phone).toBe("+79260000000")
  })

  it("правка анкеты сливается с прежними ответами, назначение пишется в историю", async () => {
    const app = await createApplication({ kind: "foster", fields: { region: "Москва" }, strict: false, source: "manual", person: { name: "Дмитрий" }, actor: agent })
    const updated = await updateApplication(app.id, { fields: { period: "До месяца" } }, agent)
    expect(updated.fields).toEqual({ region: "Москва", period: "До месяца" })
    await assignApplication(app.id, agent.userId, agent)
    const [row] = await db.select().from(t.applications).where(eq(t.applications.id, app.id))
    expect(row.assigneeId).toBe(agent.userId)
  })
})

function post(body: unknown) {
  return submitForm(new Request(`http://localhost/api/public/form/${form.id}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }), {
    params: Promise.resolve({ channelId: form.id }),
  })
}

describe("анкеты с сайта", () => {
  it("анкета платформы создаёт обращение и заявку с ответами", async () => {
    const res = await post({
      kind: "found",
      name: "Галина",
      phone: "+7 926 111-22-33",
      consent: "on",
      fields: { species: "Щенки или котята", condition: ["Без мамы"], address: "Лобня, ул. Ленина" },
    })
    expect(res.status).toBe(200)
    const [app] = await db.select().from(t.applications)
    expect(app.source).toBe("site")
    expect(app.urgent).toBe(true)
    expect(app.requestId).not.toBeNull()
    const [msg] = await db.select().from(t.messages).where(eq(t.messages.direction, "in"))
    expect(msg.text).toContain("Где находится: Лобня, ул. Ленина")
  })

  it("без согласия на обработку данных и с пустыми обязательными полями — отказ с подсказками", async () => {
    const noConsent = await post({ kind: "adopt", name: "А", email: "a@example.ru", fields: { region: "Москва", housing: "Квартира" } })
    expect(noConsent.status).toBe(400)
    const missing = await post({ kind: "adopt", name: "А", email: "a@example.ru", consent: "on", fields: {} })
    expect(missing.status).toBe(400)
    expect(Object.keys(((await missing.json()) as { errors: object }).errors).sort()).toEqual(["housing", "region"])
    expect(await db.select().from(t.requests)).toHaveLength(0)
  })

  it("форма «Взять под опеку» с сайта фонда становится заявкой «Опека»", async () => {
    const res = await post({ "form[name]": "Елена", "form[email]": "elena@example.ru", "form[animal]": "/animal/1043", "form[type]": "Буду помогать финансами" })
    expect(res.status).toBe(200)
    const [app] = await db.select().from(t.applications)
    expect(app.kind).toBe("guardianship")
    expect(app.source).toBe("form")
    expect(app.fields).toMatchObject({ format: "Ежемесячный платёж" })
  })
})

describe("обзор", () => {
  it("считает «Нашли дом» по переходу заявки «Взять питомца» в итог", async () => {
    const app = await createApplication({ kind: "adopt", fields: { animal: "Луна" }, strict: false, source: "manual", person: { name: "Анна" }, actor: agent })
    await moveStage(app.id, "done", agent)
    const data = await loadDashboard("week", { id: agent.userId, name: "Мария Котова", role: "admin" })
    expect(data.kpis.homes.value).toBe(1)
    expect(data.kpis.applications.value).toBe(1)
    expect(data.goals.homes.value).toBe(1)
    expect(data.user.firstName).toBe("Мария")
    expect(data.chart).toHaveLength(7)
  })
})
