import { sql } from "drizzle-orm"
import { db, t } from "@/db"
import { APPLICATION_KINDS, isApplicationKind, stageLabel } from "@/lib/applications/catalog"
import type { ApplicationStage } from "@/db/schema"
import { getSetting } from "@/lib/settings"

export type DashboardPeriod = "week" | "month" | "year"

const TZ = "Europe/Moscow"
const DAY = 86400_000

type Kpi = { value: number; prev: number; series: number[] }

export type DashboardData = {
  period: DashboardPeriod
  user: { firstName: string; canEditGoals: boolean }
  range: { from: string; label: string }
  summary: { newToday: number; urgentOpen: number; waitingReply: number; newApplications: number }
  kpis: {
    inquiries: Kpi
    applications: Kpi
    homes: Kpi
    replyHour: { value: number | null; prev: number | null; series: (number | null)[]; medianMin: number | null }
  }
  chart: { key: string; label: string; full: string; inquiries: number; applications: number; current: boolean }[]
  attention: {
    id: string
    type: "request" | "application"
    title: string
    subtitle: string
    at: string
    href: string
    urgent: boolean
    tone: string
    channelKind: string | null
    appKind: string | null
  }[]
  activity: { id: string; at: string; text: string; actor: string | null; href: string; tone: string; appKind: string | null; channelKind: string | null }[]
  team: { id: string; name: string; replies: number; openRequests: number; openApplications: number; lastActiveAt: string | null; online: boolean }[]
  goals: { monthLabel: string; homes: { value: number; goal: number }; replyHour: { value: number | null; goal: number }; month: { created: number; done: number; declined: number } }
  channels: { kind: string; name: string; n: number }[]
  funnel: { kind: string; open: number; byStage: Record<string, number>; doneInPeriod: number }[]
}

/** Полночь по Москве для даты d (в UTC). */
function moscowMidnight(d: Date) {
  const key = new Intl.DateTimeFormat("sv-SE", { timeZone: TZ }).format(d)
  return new Date(`${key}T00:00:00+03:00`)
}

function bucketsFor(period: DashboardPeriod, now = new Date()) {
  const fmtDay = new Intl.DateTimeFormat("ru-RU", { timeZone: TZ, day: "numeric", month: "short" })
  const fmtWeekday = new Intl.DateTimeFormat("ru-RU", { timeZone: TZ, weekday: "short" })
  const fmtMonth = new Intl.DateTimeFormat("ru-RU", { timeZone: TZ, month: "short" })
  const fmtMonthFull = new Intl.DateTimeFormat("ru-RU", { timeZone: TZ, month: "long", year: "numeric" })
  const today = moscowMidnight(now)
  if (period === "year") {
    const [y, m] = new Intl.DateTimeFormat("sv-SE", { timeZone: TZ, year: "numeric", month: "2-digit" }).format(now).split("-").map(Number)
    const monthKey = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`
    const list = Array.from({ length: 12 }, (_, i) => {
      const key = monthKey(new Date(Date.UTC(y, m - 12 + i, 1)))
      const start = new Date(`${key}-01T00:00:00+03:00`)
      const mid = new Date(start.getTime() + DAY)
      return { key, start, label: fmtMonth.format(mid).replace(".", ""), full: fmtMonthFull.format(mid) }
    })
    const prevFrom = new Date(`${monthKey(new Date(Date.UTC(y - 1, m - 12, 1)))}-01T00:00:00+03:00`)
    return { unit: "month" as const, list, from: list[0].start, prevFrom, fmt: "YYYY-MM" }
  }
  const days = period === "week" ? 7 : 30
  const list = Array.from({ length: days }, (_, i) => {
    const start = new Date(today.getTime() - (days - 1 - i) * DAY)
    const key = new Intl.DateTimeFormat("sv-SE", { timeZone: TZ }).format(start)
    const label = period === "week" ? fmtWeekday.format(start).replace(".", "") : String(Number(key.slice(8)))
    return { key, start, label, full: fmtDay.format(start) }
  })
  const from = list[0].start
  const prevFrom = new Date(from.getTime() - days * DAY)
  return { unit: "day" as const, list, from, prevFrom, fmt: "YYYY-MM-DD" }
}

const num = (v: unknown) => Number(v ?? 0)

export async function loadDashboard(period: DashboardPeriod, user: { id: string; name: string; role: string }): Promise<DashboardData> {
  const userId = user.id
  const now = new Date()
  const b = bucketsFor(period, now)
  const unit = b.unit
  const keyExpr = (col: unknown) => sql`to_char(date_trunc(${unit}, ${col} at time zone ${TZ}), ${b.fmt})`
  const keys = b.list.map((x) => x.key)
  const settings = await getSetting("applications")

  const [inq, apps, homes, reply] = await Promise.all([
    db.execute<{ k: string; n: number }>(sql`
      select ${keyExpr(sql`r.created_at`)} as k, count(*)::int as n
      from ${t.requests} r where r.created_at >= ${b.prevFrom} and r.status <> 'spam' group by 1`),
    db.execute<{ k: string; n: number }>(sql`
      select ${keyExpr(sql`a.created_at`)} as k, count(*)::int as n
      from ${t.applications} a where a.created_at >= ${b.prevFrom} group by 1`),
    db.execute<{ k: string; n: number }>(sql`
      select ${keyExpr(sql`e.created_at`)} as k, count(distinct e.application_id)::int as n
      from ${t.applicationEvents} e join ${t.applications} a on a.id = e.application_id
      where e.type = 'stage' and e.to_stage = 'done' and a.kind = 'adopt' and e.created_at >= ${b.prevFrom} group by 1`),
    // Ответили за час: среди обращений, на которые уже должны были ответить (старше часа) или ответили.
    db.execute<{ k: string; total: number; fast: number; median: number | null }>(sql`
      select ${keyExpr(sql`r.created_at`)} as k,
        count(*)::int as total,
        count(*) filter (where m.first_out is not null and m.first_out - r.created_at <= interval '60 minutes')::int as fast,
        percentile_cont(0.5) within group (order by extract(epoch from (m.first_out - r.created_at)) / 60) filter (where m.first_out is not null) as median
      from ${t.requests} r
      join ${t.channels} c on c.id = r.channel_id
      left join lateral (select min(created_at) as first_out from ${t.messages} where request_id = r.id and direction = 'out') m on true
      where r.created_at >= ${b.prevFrom} and r.status <> 'spam' and c.kind <> 'manual'
        and (m.first_out is not null or r.created_at < now() - interval '60 minutes')
      group by 1`),
  ])

  const mapOf = (rows: { k: string; n: number }[]) => new Map(rows.map((r) => [r.k, num(r.n)]))
  const inqMap = mapOf(inq.rows)
  const appMap = mapOf(apps.rows)
  const homeMap = mapOf(homes.rows)
  const replyMap = new Map(reply.rows.map((r) => [r.k, { total: num(r.total), fast: num(r.fast) }]))
  const inRange = (k: string) => keys.includes(k)
  const sum = (m: Map<string, number>, current: boolean) => [...m.entries()].filter(([k]) => inRange(k) === current).reduce((s, [, n]) => s + n, 0)
  const kpi = (m: Map<string, number>): Kpi => ({ value: sum(m, true), prev: sum(m, false), series: keys.map((k) => m.get(k) ?? 0) })
  const pct = (fast: number, total: number) => (total ? Math.round((fast / total) * 100) : null)
  const replyAgg = (current: boolean) => {
    let total = 0
    let fast = 0
    for (const [k, v] of replyMap) {
      if (inRange(k) !== current) continue
      total += v.total
      fast += v.fast
    }
    return pct(fast, total)
  }

  const [medianRow] = (
    await db.execute<{ median: number | null }>(sql`
      select percentile_cont(0.5) within group (order by extract(epoch from (m.first_out - r.created_at)) / 60) as median
      from ${t.requests} r
      join lateral (select min(created_at) as first_out from ${t.messages} where request_id = r.id and direction = 'out') m on true
      where r.created_at >= ${b.from} and m.first_out is not null`)
  ).rows

  const todayStart = moscowMidnight(now)
  const [summary] = (
    await db.execute<{ new_today: number; urgent_apps: number; urgent_reqs: number; waiting: number; new_apps: number }>(sql`
      select
        (select count(*) from ${t.requests} where created_at >= ${todayStart} and status <> 'spam')::int as new_today,
        (select count(*) from ${t.applications} where urgent and stage not in ('done','declined'))::int as urgent_apps,
        (select count(*) from ${t.requests} r where r.priority in ('urgent','high') and r.status in ('new','open','waiting') and r.last_message_direction = 'in'
          and not exists (select 1 from ${t.applications} a where a.request_id = r.id))::int as urgent_reqs,
        (select count(*) from ${t.requests} where status in ('new','open') and last_message_direction = 'in')::int as waiting,
        (select count(*) from ${t.applications} where stage = 'new')::int as new_apps`)
  ).rows

  const [attApps, attReqs] = await Promise.all([
    db.execute<{ id: string; number: number; kind: string; title: string; urgent: boolean; stage: ApplicationStage; created_at: Date; name: string | null; channel_kind: string | null }>(sql`
      select a.id, a.number, a.kind, a.title, a.urgent, a.stage, a.created_at, c.name, ch.kind as channel_kind
      from ${t.applications} a
      left join ${t.contacts} c on c.id = a.contact_id
      left join ${t.requests} r on r.id = a.request_id
      left join ${t.channels} ch on ch.id = r.channel_id
      where a.stage not in ('done','declined') and (a.urgent or a.stage = 'new')
      order by a.urgent desc, a.created_at desc limit 6`),
    db.execute<{ id: string; number: number; subject: string | null; preview: string | null; priority: string; last_at: Date; name: string; channel_kind: string; category: string | null }>(sql`
      select r.id, r.number, r.subject, r.last_message_preview as preview, r.priority, r.last_message_at as last_at, c.name, ch.kind as channel_kind, r.category
      from ${t.requests} r
      join ${t.contacts} c on c.id = r.contact_id
      join ${t.channels} ch on ch.id = r.channel_id
      where r.status in ('new','open','waiting') and r.last_message_direction = 'in'
        and not exists (select 1 from ${t.applications} a where a.request_id = r.id)
      order by (r.priority in ('urgent','high')) desc, r.last_message_at desc limit 6`),
  ])

  const attention: DashboardData["attention"] = [
    ...attApps.rows.map((a) => {
      const meta = isApplicationKind(a.kind) ? APPLICATION_KINDS[a.kind] : null
      return {
        id: `a-${a.id}`,
        type: "application" as const,
        title: a.title,
        subtitle: `${meta?.short ?? "Заявка"} · №${a.number}${a.name ? ` · ${a.name}` : ""}`,
        at: new Date(a.created_at).toISOString(),
        href: `/applications?id=${a.id}`,
        urgent: a.urgent,
        tone: a.urgent ? "#ef4444" : (meta?.color ?? "#05c7f2"),
        channelKind: a.channel_kind,
        appKind: a.kind,
      }
    }),
    ...attReqs.rows.map((r) => ({
      id: `r-${r.id}`,
      type: "request" as const,
      title: r.subject || r.preview || "Новое обращение",
      subtitle: `Ждёт ответа · ${r.name}`,
      at: new Date(r.last_at).toISOString(),
      href: `/inbox?id=${r.id}`,
      urgent: r.priority === "urgent" || r.priority === "high",
      tone: r.priority === "urgent" || r.priority === "high" ? "#ef4444" : "#a185d8",
      channelKind: r.channel_kind,
      appKind: null,
    })),
  ]
    .sort((x, y) => Number(y.urgent) - Number(x.urgent) || y.at.localeCompare(x.at))
    .slice(0, 6)

  const [events, newReqs, replies] = await Promise.all([
    db.execute<{ id: string; type: string; to_stage: string | null; text: string | null; created_at: Date; author_type: string; user_name: string | null; app_id: string; number: number; kind: string; title: string }>(sql`
      select e.id, e.type, e.to_stage, e.text, e.created_at, e.author_type, u.name as user_name, a.id as app_id, a.number, a.kind, a.title
      from ${t.applicationEvents} e
      join ${t.applications} a on a.id = e.application_id
      left join ${t.users} u on u.id = e.user_id
      where e.type in ('created','stage','assigned')
      order by e.created_at desc limit 10`),
    db.execute<{ id: string; created_at: Date; name: string; channel_kind: string; channel_name: string }>(sql`
      select r.id, r.created_at, c.name, ch.kind as channel_kind, ch.name as channel_name
      from ${t.requests} r join ${t.contacts} c on c.id = r.contact_id join ${t.channels} ch on ch.id = r.channel_id
      where r.status <> 'spam'
      order by r.created_at desc limit 8`),
    db.execute<{ id: string; created_at: Date; user_name: string; request_id: string; contact: string; channel_kind: string }>(sql`
      select m.id, m.created_at, u.name as user_name, m.request_id, c.name as contact, ch.kind as channel_kind
      from ${t.messages} m
      join ${t.users} u on u.id = m.author_user_id
      join ${t.requests} r on r.id = m.request_id
      join ${t.contacts} c on c.id = r.contact_id
      join ${t.channels} ch on ch.id = r.channel_id
      where m.direction = 'out' and m.author_type = 'agent'
      order by m.created_at desc limit 8`),
  ])

  const activity: DashboardData["activity"] = [
    ...events.rows.map((e) => {
      const meta = isApplicationKind(e.kind) ? APPLICATION_KINDS[e.kind] : null
      const who = e.user_name ?? (e.author_type === "ai" ? "Ассистент" : null)
      const text =
        e.type === "created"
          ? `Новая заявка: ${e.title}`
          : e.type === "stage"
            ? `№${e.number} → «${stageLabel(e.kind, (e.to_stage ?? "new") as ApplicationStage)}»`
            : `№${e.number}: ${e.text?.toLowerCase() ?? "назначен ответственный"}`
      return {
        id: `e-${e.id}`,
        at: new Date(e.created_at).toISOString(),
        text,
        actor: who,
        href: `/applications?id=${e.app_id}`,
        tone: e.type === "stage" && e.to_stage === "done" ? "#10b981" : (meta?.color ?? "#05c7f2"),
        appKind: e.kind,
        channelKind: null,
      }
    }),
    ...newReqs.rows.map((r) => ({
      id: `n-${r.id}`,
      at: new Date(r.created_at).toISOString(),
      text: `Новое обращение: ${r.name}`,
      actor: null,
      href: `/inbox?id=${r.id}`,
      tone: "#05c7f2",
      appKind: null,
      channelKind: r.channel_kind,
    })),
    ...replies.rows.map((m) => ({
      id: `m-${m.id}`,
      at: new Date(m.created_at).toISOString(),
      text: `Ответ: ${m.contact}`,
      actor: m.user_name,
      href: `/inbox?id=${m.request_id}`,
      tone: "#a185d8",
      appKind: null,
      channelKind: m.channel_kind,
    })),
  ]
    .sort((x, y) => y.at.localeCompare(x.at))
    .slice(0, 7)

  const team = (
    await db.execute<{ id: string; name: string; replies: number; open_requests: number; open_apps: number; last_active: Date | null }>(sql`
      select u.id, u.name,
        (select count(*) from ${t.messages} m where m.author_user_id = u.id and m.direction = 'out' and m.created_at >= ${b.from})::int as replies,
        (select count(*) from ${t.requests} r where r.assignee_id = u.id and r.status in ('new','open','waiting'))::int as open_requests,
        (select count(*) from ${t.applications} a where a.assignee_id = u.id and a.stage not in ('done','declined'))::int as open_apps,
        greatest(
          (select max(created_at) from ${t.messages} m where m.author_user_id = u.id),
          (select max(created_at) from ${t.applicationEvents} e where e.user_id = u.id)
        ) as last_active
      from ${t.users} u where u.active
      order by (u.id = ${userId}) desc, last_active desc nulls last, u.name`)
  ).rows.map((u) => ({
    id: u.id,
    name: u.name,
    replies: num(u.replies),
    openRequests: num(u.open_requests),
    openApplications: num(u.open_apps),
    lastActiveAt: u.last_active ? new Date(u.last_active).toISOString() : null,
    online: Boolean(u.last_active && now.getTime() - new Date(u.last_active).getTime() < 15 * 60_000),
  }))

  const monthStart = new Date(`${new Intl.DateTimeFormat("sv-SE", { timeZone: TZ, year: "numeric", month: "2-digit" }).format(now)}-01T00:00:00+03:00`)
  const [goalRow] = (
    await db.execute<{ homes: number; total: number; fast: number }>(sql`
      select
        (select count(distinct e.application_id) from ${t.applicationEvents} e join ${t.applications} a on a.id = e.application_id
          where e.type = 'stage' and e.to_stage = 'done' and a.kind = 'adopt' and e.created_at >= ${monthStart})::int as homes,
        count(*)::int as total,
        count(*) filter (where m.first_out - r.created_at <= interval '60 minutes')::int as fast
      from ${t.requests} r
      join ${t.channels} c on c.id = r.channel_id
      left join lateral (select min(created_at) as first_out from ${t.messages} where request_id = r.id and direction = 'out') m on true
      where r.created_at >= ${monthStart} and r.status <> 'spam' and c.kind <> 'manual'
        and (m.first_out is not null or r.created_at < now() - interval '60 minutes')`)
  ).rows

  const [monthApps] = (
    await db.execute<{ created: number; done: number; declined: number }>(sql`
      select
        (select count(*) from ${t.applications} where created_at >= ${monthStart})::int as created,
        (select count(*) from ${t.applications} where stage = 'done' and closed_at >= ${monthStart})::int as done,
        (select count(*) from ${t.applications} where stage = 'declined' and closed_at >= ${monthStart})::int as declined`)
  ).rows

  const channels = (
    await db.execute<{ kind: string; name: string; n: number }>(sql`
      select ch.kind, ch.name, count(r.id)::int as n
      from ${t.channels} ch join ${t.requests} r on r.channel_id = ch.id and r.created_at >= ${b.from} and r.status <> 'spam'
      group by ch.kind, ch.name order by n desc`)
  ).rows.map((c) => ({ kind: c.kind, name: c.name, n: num(c.n) }))

  const funnelRows = (
    await db.execute<{ kind: string; stage: ApplicationStage; n: number; done_period: number }>(sql`
      select a.kind, a.stage, count(*)::int as n,
        count(*) filter (where a.stage = 'done' and a.closed_at >= ${b.from})::int as done_period
      from ${t.applications} a
      where a.stage not in ('done','declined') or a.closed_at >= ${b.from}
      group by a.kind, a.stage`)
  ).rows
  const funnel = Object.keys(APPLICATION_KINDS).map((kind) => {
    const rows = funnelRows.filter((r) => r.kind === kind)
    const byStage = Object.fromEntries(rows.map((r) => [r.stage, num(r.n)]))
    return {
      kind,
      byStage,
      open: rows.filter((r) => r.stage !== "done" && r.stage !== "declined").reduce((s, r) => s + num(r.n), 0),
      doneInPeriod: rows.reduce((s, r) => s + num(r.done_period), 0),
    }
  })

  const currentKey = b.list[b.list.length - 1].key
  const rangeLabel = period === "week" ? "за 7 дней" : period === "month" ? "за 30 дней" : "за 12 месяцев"
  return {
    period,
    user: { firstName: user.name.split(/\s+/)[0] ?? user.name, canEditGoals: user.role === "admin" },
    range: { from: b.from.toISOString(), label: rangeLabel },
    summary: {
      newToday: num(summary?.new_today),
      urgentOpen: num(summary?.urgent_apps) + num(summary?.urgent_reqs),
      waitingReply: num(summary?.waiting),
      newApplications: num(summary?.new_apps),
    },
    kpis: {
      inquiries: kpi(inqMap),
      applications: kpi(appMap),
      homes: kpi(homeMap),
      replyHour: {
        value: replyAgg(true),
        prev: replyAgg(false),
        series: keys.map((k) => {
          const v = replyMap.get(k)
          return v ? pct(v.fast, v.total) : null
        }),
        medianMin: medianRow?.median != null ? Math.round(Number(medianRow.median)) : null,
      },
    },
    chart: b.list.map((x) => ({
      key: x.key,
      label: x.label,
      full: x.full,
      inquiries: inqMap.get(x.key) ?? 0,
      applications: appMap.get(x.key) ?? 0,
      current: x.key === currentKey,
    })),
    attention,
    activity,
    team,
    goals: {
      monthLabel: new Intl.DateTimeFormat("ru-RU", { timeZone: TZ, month: "long" }).format(now),
      homes: { value: num(goalRow?.homes), goal: settings.goals.homesPerMonth },
      replyHour: { value: pct(num(goalRow?.fast), num(goalRow?.total)), goal: settings.goals.replyWithinHourPct },
      month: { created: num(monthApps?.created), done: num(monthApps?.done), declined: num(monthApps?.declined) },
    },
    channels,
    funnel,
  }
}
