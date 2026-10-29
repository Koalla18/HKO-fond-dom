import { and, asc, desc, eq, ne } from "drizzle-orm"
import { z } from "zod"
import { db, t } from "@/db"
import { APPLICATION_STAGES } from "@/db/schema"
import { listApplications } from "@/lib/applications/query"
import { addApplicationNote, assignApplication, moveStage, updateApplication } from "@/lib/applications/service"
import { api, HttpError } from "@/lib/auth"
import { readJson } from "@/lib/validate"

type Ctx = { params: Promise<{ id: string }> }

async function idFrom(ctx: Ctx) {
  const { id } = await ctx.params
  if (!/^[0-9a-f-]{36}$/.test(id)) throw new HttpError(404, "Заявка не найдена")
  return id
}

export const GET = api(async (_req, ctx: Ctx) => {
  const id = await idFrom(ctx)
  const [app] = await listApplications({ id }, 1)
  if (!app) throw new HttpError(404, "Заявка не найдена")

  const request = app.requestId
    ? ((
        await db
          .select({
            id: t.requests.id,
            number: t.requests.number,
            status: t.requests.status,
            subject: t.requests.subject,
            channel: { kind: t.channels.kind, name: t.channels.name },
          })
          .from(t.requests)
          .innerJoin(t.channels, eq(t.channels.id, t.requests.channelId))
          .where(eq(t.requests.id, app.requestId))
          .limit(1)
      )[0] ?? null)
    : null

  const events = await db
    .select({
      id: t.applicationEvents.id,
      type: t.applicationEvents.type,
      fromStage: t.applicationEvents.fromStage,
      toStage: t.applicationEvents.toStage,
      text: t.applicationEvents.text,
      authorType: t.applicationEvents.authorType,
      authorName: t.users.name,
      createdAt: t.applicationEvents.createdAt,
    })
    .from(t.applicationEvents)
    .leftJoin(t.users, eq(t.users.id, t.applicationEvents.userId))
    .where(eq(t.applicationEvents.applicationId, id))
    .orderBy(asc(t.applicationEvents.createdAt))

  const related = app.contact?.id
    ? await db
        .select({
          id: t.applications.id,
          number: t.applications.number,
          kind: t.applications.kind,
          stage: t.applications.stage,
          title: t.applications.title,
          createdAt: t.applications.createdAt,
        })
        .from(t.applications)
        .where(and(eq(t.applications.contactId, app.contact.id), ne(t.applications.id, id)))
        .orderBy(desc(t.applications.createdAt))
        .limit(10)
    : []

  return { application: app, request, events, related }
})

const Patch = z.object({
  stage: z.enum(APPLICATION_STAGES).optional(),
  outcome: z.string().max(1000).nullable().optional(),
  assigneeId: z.string().uuid().nullable().optional(),
  fields: z.record(z.string(), z.unknown()).optional(),
  title: z.string().max(200).optional(),
  urgent: z.boolean().optional(),
  note: z.string().max(4000).optional(),
})

export const PATCH = api(async (req, ctx: Ctx, user) => {
  const id = await idFrom(ctx)
  const body = await readJson(req, Patch)
  const actor = { type: "agent" as const, userId: user.id, name: user.name }
  if (body.fields || body.title !== undefined || body.urgent !== undefined) {
    await updateApplication(id, { fields: body.fields, title: body.title, urgent: body.urgent }, actor)
  }
  if (body.assigneeId !== undefined) await assignApplication(id, body.assigneeId, actor)
  if (body.stage) await moveStage(id, body.stage, actor, body.outcome)
  else if (body.outcome !== undefined) {
    await db.update(t.applications).set({ outcome: body.outcome?.trim() || null, updatedAt: new Date() }).where(eq(t.applications.id, id))
  }
  if (body.note) await addApplicationNote(id, body.note, actor)
  return { ok: true }
})
