import { z } from "zod"
import { APPLICATION_KIND_ORDER } from "@/lib/applications/catalog"
import { applicationCounts, filtersFromUrl, listApplications } from "@/lib/applications/query"
import { createApplication } from "@/lib/applications/service"
import { api } from "@/lib/auth"
import { readJson } from "@/lib/validate"

/** Список заявок для доски и таблицы + счётчики для вкладок. */
export const GET = api(async (req, _ctx, user) => {
  const url = new URL(req.url)
  const filters = filtersFromUrl(url, user.id)
  const limit = Math.min(Number(url.searchParams.get("limit") ?? 300), 500)
  const [items, counts] = await Promise.all([listApplications(filters, limit), applicationCounts(filters)])
  return { items, ...counts, total: items.length }
})

const Body = z.object({
  kind: z.enum(APPLICATION_KIND_ORDER as [string, ...string[]]),
  fields: z.record(z.string(), z.unknown()).default({}),
  title: z.string().trim().max(200).optional(),
  urgent: z.boolean().optional(),
  requestId: z.string().uuid().optional(),
  contactId: z.string().uuid().optional(),
  person: z
    .object({
      name: z.string().trim().min(1, "укажите имя").max(200),
      phone: z.string().trim().max(40).optional(),
      email: z.string().trim().max(200).optional(),
    })
    .optional(),
  assignToMe: z.boolean().optional(),
})

/** Заявку оформляет сотрудник: из обращения во входящих или со звонка. */
export const POST = api(async (req, _ctx, user) => {
  const body = await readJson(req, Body)
  const app = await createApplication({
    kind: body.kind as (typeof APPLICATION_KIND_ORDER)[number],
    fields: body.fields,
    title: body.title,
    urgent: body.urgent,
    strict: false,
    source: body.requestId ? "inbox" : "manual",
    requestId: body.requestId ?? null,
    contactId: body.contactId ?? null,
    person: body.person,
    assigneeId: body.assignToMe === false ? null : user.id,
    actor: { type: "agent", userId: user.id, name: user.name },
  })
  return { id: app.id, number: app.number }
})
