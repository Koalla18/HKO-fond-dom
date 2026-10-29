import { and, count, desc, eq, ilike, inArray, isNull, not, or, sql, type SQL } from "drizzle-orm"
import { db, t } from "@/db"
import { APPLICATION_STAGES, type ApplicationStage } from "@/db/schema"
import { isApplicationKind } from "./catalog"

export type ApplicationFilters = {
  id?: string | null
  requestId?: string | null
  contactId?: string | null
  kind?: string | null
  stage?: string | null
  /** open — все незакрытые, closed — итог и отказ. */
  state?: "open" | "closed" | "all" | null
  assignee?: string | null
  q?: string | null
  urgent?: boolean
  /** Закрытые заявки показываем только за последние N дней (для доски). */
  closedWithinDays?: number | null
  from?: Date | null
  to?: Date | null
}

export function filtersFromUrl(url: URL, userId: string): ApplicationFilters {
  const p = url.searchParams
  const assignee = p.get("assignee")
  const state = p.get("state")
  const request = p.get("request")
  return {
    requestId: request && /^[0-9a-f-]{36}$/.test(request) ? request : null,
    kind: p.get("kind"),
    stage: p.get("stage"),
    state: state === "closed" || state === "all" ? state : state === "open" ? "open" : null,
    assignee: assignee === "me" ? userId : assignee,
    q: p.get("q")?.trim() || null,
    urgent: p.get("urgent") === "1",
    closedWithinDays: p.get("closedWithin") ? Number(p.get("closedWithin")) || null : null,
    from: p.get("from") ? new Date(String(p.get("from"))) : null,
    to: p.get("to") ? new Date(String(p.get("to"))) : null,
  }
}

function conditions(f: ApplicationFilters, opts: { skipKind?: boolean; skipStage?: boolean } = {}) {
  const where: SQL[] = []
  if (f.id) where.push(eq(t.applications.id, f.id))
  if (f.requestId) where.push(eq(t.applications.requestId, f.requestId))
  if (f.contactId) where.push(eq(t.applications.contactId, f.contactId))
  if (!opts.skipKind && f.kind && isApplicationKind(f.kind)) where.push(eq(t.applications.kind, f.kind))
  if (!opts.skipStage && f.stage && (APPLICATION_STAGES as readonly string[]).includes(f.stage)) {
    where.push(eq(t.applications.stage, f.stage as ApplicationStage))
  }
  if (f.state === "open") where.push(not(inArray(t.applications.stage, ["done", "declined"])))
  if (f.state === "closed") where.push(inArray(t.applications.stage, ["done", "declined"]))
  if (f.assignee === "none") where.push(isNull(t.applications.assigneeId))
  else if (f.assignee && /^[0-9a-f-]{36}$/.test(f.assignee)) where.push(eq(t.applications.assigneeId, f.assignee))
  if (f.urgent) where.push(eq(t.applications.urgent, true))
  if (f.closedWithinDays) {
    const since = new Date(Date.now() - f.closedWithinDays * 86400_000)
    where.push(or(isNull(t.applications.closedAt), sql`${t.applications.closedAt} >= ${since}`)!)
  }
  if (f.from && !Number.isNaN(f.from.getTime())) where.push(sql`${t.applications.createdAt} >= ${f.from}`)
  if (f.to && !Number.isNaN(f.to.getTime())) where.push(sql`${t.applications.createdAt} < ${f.to}`)
  if (f.q) {
    const like = `%${f.q.replace(/[%_]/g, "\\$&")}%`
    const byNumber = /^#?\d+$/.test(f.q) ? [eq(t.applications.number, Number(f.q.replace("#", "")))] : []
    where.push(
      or(
        ilike(t.applications.title, like),
        ilike(t.contacts.name, like),
        ilike(t.contacts.phone, like),
        ilike(t.contacts.email, like),
        sql`${t.applications.fields}::text ilike ${like}`,
        ...byNumber,
      )!,
    )
  }
  return where.length ? and(...where) : undefined
}

export async function listApplications(f: ApplicationFilters, limit = 300) {
  const items = await db
    .select({
      id: t.applications.id,
      number: t.applications.number,
      kind: t.applications.kind,
      stage: t.applications.stage,
      title: t.applications.title,
      urgent: t.applications.urgent,
      source: t.applications.source,
      fields: t.applications.fields,
      requestId: t.applications.requestId,
      outcome: t.applications.outcome,
      createdAt: t.applications.createdAt,
      updatedAt: t.applications.updatedAt,
      stageChangedAt: t.applications.stageChangedAt,
      closedAt: t.applications.closedAt,
      contact: { id: t.contacts.id, name: t.contacts.name, phone: t.contacts.phone, email: t.contacts.email, avatarUrl: t.contacts.avatarUrl },
      assignee: { id: t.users.id, name: t.users.name },
      channelKind: t.channels.kind,
    })
    .from(t.applications)
    .leftJoin(t.contacts, eq(t.contacts.id, t.applications.contactId))
    .leftJoin(t.users, eq(t.users.id, t.applications.assigneeId))
    .leftJoin(t.requests, eq(t.requests.id, t.applications.requestId))
    .leftJoin(t.channels, eq(t.channels.id, t.requests.channelId))
    .where(conditions(f))
    .orderBy(desc(t.applications.urgent), desc(t.applications.createdAt))
    .limit(limit)
  return items
}

export async function applicationCounts(f: ApplicationFilters) {
  const byKind = await db
    .select({ kind: t.applications.kind, n: count() })
    .from(t.applications)
    .leftJoin(t.contacts, eq(t.contacts.id, t.applications.contactId))
    .where(and(conditions({ ...f, state: f.state ?? "open", stage: null }, { skipKind: true })))
    .groupBy(t.applications.kind)
  const byStage = await db
    .select({ stage: t.applications.stage, n: count() })
    .from(t.applications)
    .leftJoin(t.contacts, eq(t.contacts.id, t.applications.contactId))
    .where(conditions({ ...f, state: null }, { skipStage: true }))
    .groupBy(t.applications.stage)
  return {
    byKind: Object.fromEntries(byKind.map((r) => [r.kind, r.n])),
    byStage: Object.fromEntries(byStage.map((r) => [r.stage, r.n])),
  }
}
