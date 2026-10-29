import { and, eq, isNull } from "drizzle-orm"
import { db, t } from "@/db"
import type { Application, ApplicationSource, ApplicationStage } from "@/db/schema"
import { HttpError } from "@/lib/auth"
import { normalizeEmail, normalizePhone } from "@/lib/channels/ingest"
import { publish } from "@/lib/events"
import {
  APPLICATION_KINDS,
  applicationTitle,
  isClosedStage,
  isUrgent,
  stageLabel,
  validateFields,
  type ApplicationFieldValue,
  type ApplicationKind,
} from "./catalog"

type Actor = { type: "agent"; userId: string; name: string } | { type: "ai" } | { type: "system" } | { type: "contact" }

const authorOf = (actor: Actor) => ({ authorType: actor.type, userId: actor.type === "agent" ? actor.userId : null })

export type NewApplication = {
  kind: ApplicationKind
  fields: Record<string, unknown>
  /** Строгая проверка анкеты (публичная форма) или черновик сотрудника. */
  strict: boolean
  source: ApplicationSource
  actor: Actor
  requestId?: string | null
  contactId?: string | null
  /** Новый человек — если заявку заводят без обращения (звонок, визит). */
  person?: { name: string; phone?: string | null; email?: string | null }
  urgent?: boolean
  assigneeId?: string | null
  title?: string
}

async function contactFor(input: NewApplication) {
  if (input.contactId) return input.contactId
  if (input.requestId) {
    const [request] = await db.select({ contactId: t.requests.contactId }).from(t.requests).where(eq(t.requests.id, input.requestId)).limit(1)
    if (!request) throw new HttpError(404, "Обращение не найдено")
    return request.contactId
  }
  if (!input.person) return null
  const email = normalizeEmail(input.person.email)
  const phone = normalizePhone(input.person.phone)
  const existing =
    (email && (await db.select().from(t.contacts).where(eq(t.contacts.email, email)).limit(1))[0]) ||
    (phone && (await db.select().from(t.contacts).where(eq(t.contacts.phone, phone)).limit(1))[0]) ||
    null
  if (existing) return existing.id
  const [created] = await db.insert(t.contacts).values({ name: input.person.name.trim().slice(0, 200), email, phone }).returning({ id: t.contacts.id })
  return created.id
}

export async function createApplication(input: NewApplication): Promise<Application> {
  const meta = APPLICATION_KINDS[input.kind]
  const { fields, errors } = validateFields(input.kind, input.fields, input.strict)
  const firstError = Object.entries(errors)[0]
  if (firstError) {
    const label = meta.fields.find((f) => f.key === firstError[0])?.label ?? firstError[0]
    throw new HttpError(400, `${label}: ${firstError[1].toLowerCase()}`)
  }
  const contactId = await contactFor(input)
  const [app] = await db
    .insert(t.applications)
    .values({
      kind: input.kind,
      title: (input.title?.trim() || applicationTitle(input.kind, fields)).slice(0, 200),
      urgent: input.urgent ?? isUrgent(input.kind, fields),
      fields,
      contactId,
      requestId: input.requestId ?? null,
      source: input.source,
      assigneeId: input.assigneeId ?? null,
    })
    .returning()
  await db.insert(t.applicationEvents).values({ applicationId: app.id, type: "created", toStage: "new", ...authorOf(input.actor) })
  if (app.requestId) {
    const who = input.actor.type === "agent" ? ` — ${input.actor.name}` : input.actor.type === "ai" ? " — ассистент" : ""
    await db.insert(t.messages).values({
      requestId: app.requestId,
      direction: "internal",
      authorType: input.actor.type === "ai" ? "ai" : "system",
      text: `Оформлена заявка №${app.number} «${meta.title}»${who}`,
      meta: { applicationId: app.id },
    })
    // Категория обращения подтягивается из вида заявки, если её ещё не ставили.
    await db
      .update(t.requests)
      .set({ category: meta.category })
      .where(and(eq(t.requests.id, app.requestId), isNull(t.requests.category)))
    if (app.urgent) await db.update(t.requests).set({ priority: "urgent" }).where(eq(t.requests.id, app.requestId))
    publish({ type: "request.updated", requestId: app.requestId })
  }
  publish({ type: "application.created", applicationId: app.id, requestId: app.requestId })
  return app
}

async function load(id: string) {
  const [app] = await db.select().from(t.applications).where(eq(t.applications.id, id)).limit(1)
  if (!app) throw new HttpError(404, "Заявка не найдена")
  return app
}

export async function moveStage(id: string, stage: ApplicationStage, actor: Actor, outcome?: string | null) {
  const app = await load(id)
  if (app.stage === stage && outcome === undefined) return app
  const now = new Date()
  const [updated] = await db
    .update(t.applications)
    .set({
      stage,
      updatedAt: now,
      stageChangedAt: app.stage === stage ? app.stageChangedAt : now,
      closedAt: isClosedStage(stage) ? (app.closedAt ?? now) : null,
      ...(outcome !== undefined ? { outcome: outcome?.trim().slice(0, 1000) || null } : {}),
    })
    .where(eq(t.applications.id, id))
    .returning()
  if (app.stage !== stage) {
    await db.insert(t.applicationEvents).values({
      applicationId: id,
      type: "stage",
      fromStage: app.stage,
      toStage: stage,
      text: outcome?.trim() || null,
      ...authorOf(actor),
    })
    if (app.requestId) {
      await db.insert(t.messages).values({
        requestId: app.requestId,
        direction: "internal",
        authorType: actor.type === "ai" ? "ai" : "system",
        text: `Заявка №${app.number}: «${stageLabel(app.kind, stage)}»${actor.type === "agent" ? ` — ${actor.name}` : ""}`,
        meta: { applicationId: id },
      })
      publish({ type: "request.updated", requestId: app.requestId })
    }
  }
  publish({ type: "application.updated", applicationId: id, requestId: app.requestId })
  return updated
}

export async function assignApplication(id: string, assigneeId: string | null, actor: Actor) {
  const app = await load(id)
  if (app.assigneeId === assigneeId) return app
  let name: string | null = null
  if (assigneeId) {
    const [user] = await db.select({ name: t.users.name, active: t.users.active }).from(t.users).where(eq(t.users.id, assigneeId)).limit(1)
    if (!user?.active) throw new HttpError(400, "Сотрудник не найден")
    name = user.name
  }
  const [updated] = await db.update(t.applications).set({ assigneeId, updatedAt: new Date() }).where(eq(t.applications.id, id)).returning()
  await db.insert(t.applicationEvents).values({
    applicationId: id,
    type: "assigned",
    text: name ? `Ответственный: ${name}` : "Ответственный снят",
    ...authorOf(actor),
  })
  publish({ type: "application.updated", applicationId: id, requestId: app.requestId })
  return updated
}

export async function updateApplication(
  id: string,
  patch: { fields?: Record<string, unknown>; title?: string; urgent?: boolean },
  actor: Actor,
) {
  const app = await load(id)
  const kind = app.kind as ApplicationKind
  const next: Partial<typeof t.applications.$inferInsert> = { updatedAt: new Date() }
  if (patch.fields) {
    const { fields } = validateFields(kind, { ...app.fields, ...patch.fields }, false)
    next.fields = fields
  }
  if (patch.title !== undefined) next.title = patch.title.trim().slice(0, 200) || applicationTitle(kind, (next.fields ?? app.fields) as Record<string, ApplicationFieldValue>)
  if (patch.urgent !== undefined) next.urgent = patch.urgent
  const [updated] = await db.update(t.applications).set(next).where(eq(t.applications.id, id)).returning()
  const what = [patch.fields && "анкета", patch.title !== undefined && "заголовок", patch.urgent !== undefined && (patch.urgent ? "срочно" : "не срочно")].filter(Boolean)
  await db.insert(t.applicationEvents).values({ applicationId: id, type: "updated", text: `Изменено: ${what.join(", ")}`, ...authorOf(actor) })
  publish({ type: "application.updated", applicationId: id, requestId: app.requestId })
  return updated
}

export async function addApplicationNote(id: string, text: string, actor: Actor) {
  const app = await load(id)
  const clean = text.trim().slice(0, 4000)
  if (!clean) throw new HttpError(400, "Пустая заметка")
  await db.insert(t.applicationEvents).values({ applicationId: id, type: "note", text: clean, ...authorOf(actor) })
  await db.update(t.applications).set({ updatedAt: new Date() }).where(eq(t.applications.id, id))
  publish({ type: "application.updated", applicationId: id, requestId: app.requestId })
}
