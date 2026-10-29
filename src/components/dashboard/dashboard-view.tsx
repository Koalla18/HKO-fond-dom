"use client"

import { ArrowRight, Clock3, Download, HeartHandshake, House, Inbox, MessagesSquare, Pencil, ShieldCheck } from "lucide-react"
import Link from "next/link"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { useMemo, useState } from "react"
import { toast } from "sonner"
import useSWR from "swr"
import { ChannelIcon } from "@/components/app/channel-icon"
import { KindIcon } from "@/components/applications/kind-icon"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { APPLICATION_KINDS, isApplicationKind, STAGE_TONES } from "@/lib/applications/catalog"
import { CHANNELS, type ChannelKind } from "@/lib/channels/catalog"
import { apiFetch } from "@/lib/client"
import type { DashboardData, DashboardPeriod } from "@/lib/dashboard"
import { ago, initials, plural } from "@/lib/format"
import { cn } from "@/lib/utils"
import { Delta, Glass, GlassTitle, Ring, Segmented, Sparkline } from "@/components/app/glass"
import { PageHeader, PageShell } from "@/components/app/page-header"

const PERIODS: { id: DashboardPeriod; label: string }[] = [
  { id: "week", label: "Неделя" },
  { id: "month", label: "Месяц" },
  { id: "year", label: "Год" },
]

const TONE = { inquiries: "#05c7f2", applications: "#b9a3f0", homes: "#fbbf24", reply: "#34d399" }

function greeting() {
  const hour = Number(new Intl.DateTimeFormat("ru-RU", { timeZone: "Europe/Moscow", hour: "numeric", hourCycle: "h23" }).format(new Date()))
  if (hour >= 5 && hour < 12) return "Доброе утро"
  if (hour >= 12 && hour < 17) return "Добрый день"
  if (hour >= 17 && hour < 23) return "Добрый вечер"
  return "Доброй ночи"
}

const nf = new Intl.NumberFormat("ru-RU")

export function DashboardView() {
  const params = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const fromUrl = params.get("period")
  const period: DashboardPeriod = fromUrl === "month" || fromUrl === "year" ? fromUrl : "week"
  const setPeriod = (p: DashboardPeriod) => router.replace(p === "week" ? pathname : `${pathname}?period=${p}`, { scroll: false })
  const { data, mutate } = useSWR<DashboardData>(`/api/dashboard?period=${period}`, { refreshInterval: 60_000, keepPreviousData: true })

  return (
    <PageShell>
      <PageHeader
        title={`${greeting()}${data ? `, ${data.user.firstName}` : ""}`}
        description={<Summary data={data} />}
        actions={
          <>
            <Segmented label="Период" value={period} onChange={setPeriod} options={PERIODS} />
            <a
              href={data ? `/api/applications/export?state=all&from=${encodeURIComponent(data.range.from)}` : undefined}
              className="glass-chip hidden items-center gap-2 rounded-full px-4 py-2.5 text-sm sm:flex"
              title="Заявки за выбранный период в Excel"
            >
              <Download className="size-4" /> Выгрузить
            </a>
          </>
        }
      />
      <div className="space-y-5">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <KpiCard
            delay={0}
            icon={MessagesSquare}
            tone={TONE.inquiries}
            label="Обращения"
            value={data ? nf.format(data.kpis.inquiries.value) : null}
            delta={data && <Delta value={data.kpis.inquiries.value} prev={data.kpis.inquiries.prev} />}
            caption={data ? `${data.range.label} · было ${nf.format(data.kpis.inquiries.prev)}` : ""}
            series={data?.kpis.inquiries.series}
            href="/inbox?view=all"
          />
          <KpiCard
            delay={60}
            icon={HeartHandshake}
            tone={TONE.applications}
            label="Заявки"
            value={data ? nf.format(data.kpis.applications.value) : null}
            delta={data && <Delta value={data.kpis.applications.value} prev={data.kpis.applications.prev} />}
            caption={data ? `${data.range.label} · было ${nf.format(data.kpis.applications.prev)}` : ""}
            series={data?.kpis.applications.series}
            href="/applications"
          />
          <KpiCard
            delay={120}
            icon={House}
            tone={TONE.homes}
            label="Нашли дом"
            value={data ? nf.format(data.kpis.homes.value) : null}
            delta={data && <Delta value={data.kpis.homes.value} prev={data.kpis.homes.prev} />}
            caption={data ? `в новых семьях ${data.range.label}` : ""}
            series={data?.kpis.homes.series}
            href="/applications?kind=adopt&view=list&state=closed"
          />
          <KpiCard
            delay={180}
            icon={Clock3}
            tone={TONE.reply}
            label="Ответили за час"
            value={data ? (data.kpis.replyHour.value == null ? "—" : `${data.kpis.replyHour.value}%`) : null}
            delta={data && <Delta value={data.kpis.replyHour.value} prev={data.kpis.replyHour.prev} suffix="п.п." />}
            caption={data ? (data.kpis.replyHour.medianMin != null ? `обычно отвечаем за ${humanMinutes(data.kpis.replyHour.medianMin)}` : "ответов пока нет") : ""}
            series={data?.kpis.replyHour.series}
            href="/inbox"
          />
        </div>

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
          <BarsCard data={data} />
          <AttentionCard data={data} />
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)_minmax(0,0.9fr)]">
          <ActivityCard data={data} />
          <TeamCard data={data} />
          <GoalsCard data={data} onSaved={() => mutate()} />
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.4fr)]">
          <ChannelsCard data={data} />
          <FunnelCard data={data} />
        </div>
      </div>
    </PageShell>
  )
}

function Summary({ data }: { data?: DashboardData }) {
  if (!data) return <span className="block h-5 w-72 animate-pulse rounded-full bg-white/15" />
  const { newToday, urgentOpen, newApplications } = data.summary
  const parts = [
    <span key="t">
      сегодня <b className="font-semibold text-white">{newToday}</b> {plural(newToday, "новое обращение", "новых обращения", "новых обращений")}
    </span>,
    urgentOpen > 0 ? (
      <Link key="u" href="/applications?urgent=1" className="underline decoration-rose-300/60 underline-offset-4 hover:decoration-rose-300">
        <b className="font-semibold text-rose-200">{urgentOpen}</b> {plural(urgentOpen, "срочное ждёт", "срочных ждут", "срочных ждут")} решения
      </Link>
    ) : (
      <span key="u">срочных нет</span>
    ),
    <Link key="a" href="/applications" className="hover:text-white">
      <b className="font-semibold text-white">{newApplications}</b> {plural(newApplications, "новая заявка", "новые заявки", "новых заявок")}
    </Link>,
  ]
  return (
    <span className="flex flex-wrap items-center gap-x-2 text-[15px] text-white/70">
      {parts.map((p, i) => (
        <span key={i} className="flex items-center gap-2">
          {i > 0 && <span className="size-1 rounded-full bg-white/35" />}
          {p}
        </span>
      ))}
    </span>
  )
}

function humanMinutes(min: number) {
  if (min < 60) return `${min} мин`
  const h = Math.floor(min / 60)
  return h < 48 ? `${h} ч${min % 60 ? ` ${min % 60} мин` : ""}` : `${Math.round(h / 24)} дн`
}

function KpiCard({
  icon: Icon,
  tone,
  label,
  value,
  delta,
  caption,
  series,
  href,
  delay,
}: {
  icon: typeof Inbox
  tone: string
  label: string
  value: string | null
  delta: React.ReactNode
  caption: string
  series?: (number | null)[]
  href: string
  delay: number
}) {
  return (
    <Link href={href} prefetch={false} className="group block focus-visible:outline-none">
      <Glass className="glass-rise flex h-full flex-col gap-4 p-5 transition-transform duration-300 group-hover:-translate-y-0.5 group-focus-visible:ring-2 group-focus-visible:ring-white/60" style={{ animationDelay: `${delay}ms` }}>
        <div className="flex items-center gap-3">
          <span
            className="flex size-10 items-center justify-center rounded-2xl border border-white/10"
            style={{ background: `color-mix(in oklab, ${tone} 30%, rgb(9 14 32 / 0.45))`, color: tone }}
          >
            <Icon className="size-5" />
          </span>
          <span className="text-sm font-medium text-white/80">{label}</span>
          <ArrowRight className="ml-auto size-4 text-white/35 transition-all group-hover:translate-x-0.5 group-hover:text-white/80" />
        </div>
        <div className="flex items-end justify-between gap-3">
          {value == null ? (
            <span className="block h-9 w-20 animate-pulse rounded-xl bg-white/15" />
          ) : (
            <div className="flex shrink-0 items-center gap-2">
              <span className="text-[34px] leading-none font-semibold tracking-tight tabular-nums">{value}</span>
              {delta}
            </div>
          )}
          {series && <Sparkline values={series} color={tone} className="-mb-1 mr-1.5 w-full max-w-28 min-w-12" />}
        </div>
        <p className="-mt-1 truncate text-xs text-white/55">{caption}</p>
      </Glass>
    </Link>
  )
}

function BarsCard({ data }: { data?: DashboardData }) {
  const [hover, setHover] = useState<number | null>(null)
  const chart = useMemo(() => data?.chart ?? [], [data])
  const max = Math.max(1, ...chart.map((c) => c.inquiries))
  const peak = chart.reduce((best, c, i) => (c.inquiries > (chart[best]?.inquiries ?? -1) ? i : best), chart.length - 1)
  const focus = hover ?? peak
  const f = chart[focus]
  const dense = chart.length > 14
  const ticks = [1, 0.5, 0]

  return (
    <Glass className="glass-rise flex min-h-[360px] flex-col p-6" style={{ animationDelay: "120ms" }}>
      <GlassTitle
        title="Обращения и заявки"
        hint={data ? `${data.range.label}: ${nf.format(data.kpis.inquiries.value)} ${plural(data.kpis.inquiries.value, "обращение", "обращения", "обращений")}, ${nf.format(data.kpis.applications.value)} ${plural(data.kpis.applications.value, "заявка", "заявки", "заявок")}` : " "}
        action={
          <div className="hidden items-center gap-3 text-xs text-white/65 sm:flex">
            <span className="flex items-center gap-1.5">
              <span className="size-2.5 rounded-full border border-white/40 bg-white/25" /> обращения
            </span>
            <span className="flex items-center gap-1.5">
              <span className="size-2.5 rounded-full bg-[#05c7f2]" /> из них заявки
            </span>
          </div>
        }
      />
      <div className="relative mt-6 flex flex-1 gap-3">
        <div className="flex w-7 flex-col justify-between pb-7 text-right text-[11px] text-white/40 tabular-nums">
          {ticks.map((t) => (
            <span key={t}>{Math.round(max * t)}</span>
          ))}
        </div>
        <div className="relative flex-1">
          <div className="pointer-events-none absolute inset-x-0 top-0 bottom-7 flex flex-col justify-between">
            {ticks.map((t) => (
              <span key={t} className="border-t border-dashed border-white/10" />
            ))}
          </div>
          <div
            className={cn("absolute inset-x-0 top-0 bottom-0 flex items-end", dense ? "gap-1" : "gap-3 sm:gap-5")}
            role="img"
            aria-label={`Обращения по ${dense ? "дням" : "периодам"}: ${chart.map((c) => `${c.full} — ${c.inquiries}`).join(", ")}`}
            onMouseLeave={() => setHover(null)}
          >
            {chart.map((c, i) => {
              const active = i === focus
              const h = Math.max(4, (c.inquiries / max) * 100)
              const appShare = c.inquiries ? Math.min(1, c.applications / c.inquiries) : 0
              return (
                <div key={c.key} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end" onMouseEnter={() => setHover(i)}>
                  <div className="relative flex w-full flex-1 items-end justify-center pb-2">
                    {active && f && (
                      <div
                        className="absolute z-10 rounded-xl border border-white/20 bg-[#0b1229]/85 px-2.5 py-1.5 text-center text-[11px] whitespace-nowrap shadow-lg backdrop-blur-md"
                        style={{
                          bottom: `min(calc(${h}% + 14px), calc(100% - 46px))`,
                          ...(i === chart.length - 1 ? { right: 0 } : i === 0 ? { left: 0 } : {}),
                        }}
                      >
                        <div className="font-medium text-white">{f.full}</div>
                        <div className="text-white/70 tabular-nums">
                          {f.inquiries} обр. · <span className="text-[#7ee3fa]">{f.applications} заяв.</span>
                        </div>
                      </div>
                    )}
                    <div
                      className={cn(
                        "bar-grow relative w-full overflow-hidden transition-[background,box-shadow] duration-300",
                        dense ? "max-w-[18px] rounded-full" : "max-w-[64px] rounded-[18px]",
                        active
                          ? "bg-gradient-to-b from-[#7ee3fa] to-[#0a7d9e] shadow-[0_0_28px_rgba(5,199,242,.65),inset_0_1px_0_rgba(255,255,255,.6)]"
                          : "border border-white/15 bg-white/[0.09] shadow-[inset_0_1px_0_rgba(255,255,255,.18)]",
                      )}
                      style={{ height: `${h}%`, animationDelay: `${150 + i * (dense ? 12 : 45)}ms` }}
                    >
                      {!active && c.applications > 0 && (
                        <span className="absolute inset-x-0 bottom-0 rounded-[inherit] bg-gradient-to-t from-[#05c7f2]/55 to-[#05c7f2]/15" style={{ height: `${appShare * 100}%` }} />
                      )}
                      {active && c.applications > 0 && <span className="absolute inset-x-0 bottom-0 bg-white/25" style={{ height: `${appShare * 100}%` }} />}
                    </div>
                  </div>
                  <span className={cn("h-5 text-[11px] tabular-nums", active ? "font-semibold text-white" : "text-white/50", dense && i % 3 !== 0 && i !== chart.length - 1 && "invisible")}>{c.label}</span>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </Glass>
  )
}

function AttentionCard({ data }: { data?: DashboardData }) {
  return (
    <Glass className="glass-rise flex flex-col p-6" style={{ animationDelay: "180ms" }}>
      <GlassTitle
        title="Требует внимания"
        hint={new Intl.DateTimeFormat("ru-RU", { timeZone: "Europe/Moscow", weekday: "long", day: "numeric", month: "long" }).format(new Date())}
        action={
          data && data.attention.length > 0 ? (
            <span className="rounded-full bg-rose-400/20 px-2.5 py-1 text-xs font-medium text-rose-100 tabular-nums">{data.attention.filter((a) => a.urgent).length} срочно</span>
          ) : null
        }
      />
      <ul className="mt-5 flex-1 space-y-2.5">
        {!data &&
          Array.from({ length: 4 }).map((_, i) => (
            <li key={i} className="h-16 animate-pulse rounded-2xl bg-white/10" />
          ))}
        {data?.attention.length === 0 && (
          <li className="flex h-full flex-col items-center justify-center gap-2 py-10 text-center text-sm text-white/65">
            <ShieldCheck className="size-8 text-emerald-300" />
            Всё разобрано — новых и срочных нет
          </li>
        )}
        {data?.attention.map((a) => (
          <li key={a.id}>
            <Link
              prefetch={false}
              href={a.href}
              className="group flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.06] py-2.5 pr-3 pl-3.5 transition-colors hover:bg-white/[0.12]"
              style={{ boxShadow: `inset 3px 0 0 ${a.tone}` }}
            >
              {a.appKind ? <KindIcon kind={a.appKind} size="sm" className="bg-white/90!" /> : a.channelKind ? <ChannelIcon kind={a.channelKind} size="sm" /> : null}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-white">{a.title}</span>
                <span className="block truncate text-xs text-white/55">{a.subtitle}</span>
              </span>
              <span className="shrink-0 text-right text-[11px] text-white/50">
                {a.urgent && <span className="mb-0.5 block font-semibold text-rose-200">срочно</span>}
                {ago(a.at).replace(" назад", "")}
              </span>
            </Link>
          </li>
        ))}
      </ul>
      <div className="mt-4 flex gap-2 text-sm">
        <Link href="/applications" className="glass-chip flex flex-1 items-center justify-center gap-1.5 rounded-full py-2">
          Заявки <ArrowRight className="size-3.5" />
        </Link>
        <Link href="/inbox" className="glass-chip flex flex-1 items-center justify-center gap-1.5 rounded-full py-2">
          Входящие <ArrowRight className="size-3.5" />
        </Link>
      </div>
    </Glass>
  )
}

function ActivityCard({ data }: { data?: DashboardData }) {
  return (
    <Glass className="glass-rise p-6" style={{ animationDelay: "220ms" }}>
      <GlassTitle title="Последние события" hint="Что происходит в фонде прямо сейчас" />
      <ul className="mt-5 space-y-1">
        {!data && Array.from({ length: 5 }).map((_, i) => <li key={i} className="h-10 animate-pulse rounded-xl bg-white/10" />)}
        {data?.activity.map((e) => (
          <li key={e.id}>
            <Link prefetch={false} href={e.href} className="flex items-center gap-3 rounded-xl px-2 py-2 transition-colors hover:bg-white/[0.08]">
              <span className="relative flex size-8 shrink-0 items-center justify-center rounded-full" style={{ background: `color-mix(in oklab, ${e.tone} 25%, transparent)` }}>
                {e.appKind ? (
                  <KindIcon kind={e.appKind} size="sm" className="bg-transparent!" />
                ) : e.channelKind ? (
                  <ChannelIcon kind={e.channelKind} size="xs" />
                ) : (
                  <span className="size-2 rounded-full" style={{ background: e.tone }} />
                )}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm text-white/90">{e.text}</span>
                <span className="block truncate text-xs text-white/50">
                  {e.actor ? `${e.actor} · ` : ""}
                  {ago(e.at)}
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </Glass>
  )
}

const AVATAR_TONES = ["#05c7f2", "#b9a3f0", "#fbbf24", "#34d399", "#f472b6", "#60a5fa"]

function TeamCard({ data }: { data?: DashboardData }) {
  const maxLoad = Math.max(1, ...(data?.team ?? []).map((u) => u.openApplications + u.openRequests))
  return (
    <Glass className="glass-rise p-6" style={{ animationDelay: "260ms" }}>
      <GlassTitle title="Команда" hint={data ? `ответы и работа в руках · ${data.range.label}` : " "} />
      <ul className="mt-5 space-y-3.5">
        {!data && Array.from({ length: 4 }).map((_, i) => <li key={i} className="h-11 animate-pulse rounded-xl bg-white/10" />)}
        {data?.team.map((u, i) => {
          const online = u.online
          const load = u.openApplications + u.openRequests
          return (
            <li key={u.id} className="flex items-center gap-3">
              <span className="relative">
                <span className="flex size-9 items-center justify-center rounded-full text-xs font-semibold text-[#0c143b]" style={{ background: AVATAR_TONES[i % AVATAR_TONES.length] }}>
                  {initials(u.name)}
                </span>
                <span className={cn("absolute -right-0.5 -bottom-0.5 size-3 rounded-full border-2 border-[#1a2238]", online ? "bg-emerald-400" : "bg-white/30")} title={online ? "сейчас в работе" : "не в сети"} />
              </span>
              <span className="min-w-0 flex-1 space-y-1">
                <span className="flex items-baseline justify-between gap-2">
                  <span className="truncate text-sm font-medium text-white">{u.name}</span>
                  <span className="shrink-0 text-[11px] text-white/50">{u.lastActiveAt ? ago(u.lastActiveAt) : "ещё не отвечал(а)"}</span>
                </span>
                <span className="block h-1.5 overflow-hidden rounded-full bg-white/10">
                  <span className="block h-full rounded-full bg-gradient-to-r from-[#05c7f2] to-[#b9a3f0]" style={{ width: `${(load / maxLoad) * 100}%` }} />
                </span>
                <span className="block text-[11px] text-white/55 tabular-nums">
                  {u.replies} {plural(u.replies, "ответ", "ответа", "ответов")} · {u.openApplications} {plural(u.openApplications, "заявка", "заявки", "заявок")} и {u.openRequests} обр. в работе
                </span>
              </span>
            </li>
          )
        })}
      </ul>
    </Glass>
  )
}

function GoalsCard({ data, onSaved }: { data?: DashboardData; onSaved: () => void }) {
  const goals = data?.goals
  return (
    <Glass className="glass-rise p-6" style={{ animationDelay: "300ms" }}>
      <GlassTitle
        title={goals ? `Цели на ${goals.monthLabel}` : "Цели месяца"}
        hint="Месяц целиком, по календарю"
        action={goals && data?.user.canEditGoals ? <GoalsEditor goals={goals} onSaved={onSaved} /> : null}
      />
      <div className="mt-5 grid grid-cols-2 gap-4">
        {!goals ? (
          <>
            <div className="mx-auto size-[104px] animate-pulse rounded-full bg-white/10" />
            <div className="mx-auto size-[104px] animate-pulse rounded-full bg-white/10" />
          </>
        ) : (
          <>
            <div className="flex flex-col items-center gap-2 text-center">
              <Ring value={goals.homes.value} goal={goals.homes.goal} color={TONE.homes}>
                <span className="text-2xl font-semibold tabular-nums">{goals.homes.value}</span>
                <span className="text-[11px] text-white/55">из {goals.homes.goal}</span>
              </Ring>
              <span className="text-xs text-white/75">
                Нашли дом
                {goals.homes.value >= goals.homes.goal && goals.homes.goal > 0 && <span className="block text-amber-200">цель взята 🎉</span>}
              </span>
            </div>
            <div className="flex flex-col items-center gap-2 text-center">
              <Ring value={goals.replyHour.value ?? 0} goal={100} color={TONE.reply}>
                <span className="text-2xl font-semibold tabular-nums">{goals.replyHour.value == null ? "—" : `${goals.replyHour.value}%`}</span>
                <span className="text-[11px] text-white/55">цель {goals.replyHour.goal}%</span>
              </Ring>
              <span className="text-xs text-white/75">Ответ за час</span>
            </div>
          </>
        )}
      </div>
      {goals && (
        <dl className="mt-6 grid grid-cols-3 gap-2 border-t border-white/10 pt-4 text-center">
          {[
            { label: "Заявок", value: goals.month.created, cls: "text-white" },
            { label: "С итогом", value: goals.month.done, cls: "text-emerald-200" },
            { label: "Отказ", value: goals.month.declined, cls: "text-white/70" },
          ].map((m) => (
            <div key={m.label} className="flex flex-col-reverse gap-0.5">
              <dt className="text-[11px] text-white/50">{m.label}</dt>
              <dd className={cn("text-xl font-semibold tabular-nums", m.cls)}>{m.value}</dd>
            </div>
          ))}
        </dl>
      )}
    </Glass>
  )
}

function GoalsEditor({ goals, onSaved }: { goals: DashboardData["goals"]; onSaved: () => void }) {
  const [homes, setHomes] = useState(String(goals.homes.goal))
  const [reply, setReply] = useState(String(goals.replyHour.goal))
  const [open, setOpen] = useState(false)
  async function save() {
    try {
      await apiFetch("/api/settings", {
        method: "PATCH",
        json: { applications: { goals: { homesPerMonth: Math.max(0, Math.round(Number(homes) || 0)), replyWithinHourPct: Math.min(100, Math.max(0, Math.round(Number(reply) || 0))) } } },
      })
      toast.success("Цели сохранены")
      setOpen(false)
      onSaved()
    } catch (err) {
      toast.error((err as Error).message)
    }
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" className="glass-chip flex size-8 items-center justify-center rounded-full" aria-label="Изменить цели">
          <Pencil className="size-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 space-y-3">
        <p className="text-sm font-medium">Цели на месяц</p>
        <label className="block space-y-1 text-xs text-muted-foreground">
          Пристроить животных
          <Input type="number" min={0} value={homes} onChange={(e) => setHomes(e.target.value)} />
        </label>
        <label className="block space-y-1 text-xs text-muted-foreground">
          Отвечать за час, %
          <Input type="number" min={0} max={100} value={reply} onChange={(e) => setReply(e.target.value)} />
        </label>
        <Button size="sm" className="w-full" onClick={save}>
          Сохранить
        </Button>
      </PopoverContent>
    </Popover>
  )
}

function ChannelsCard({ data }: { data?: DashboardData }) {
  const total = (data?.channels ?? []).reduce((s, c) => s + c.n, 0)
  return (
    <Glass className="glass-rise p-6" style={{ animationDelay: "340ms" }}>
      <GlassTitle title="Откуда пишут" hint={data ? `${nf.format(total)} ${plural(total, "обращение", "обращения", "обращений")} ${data.range.label}` : " "} />
      <ul className="mt-5 space-y-3">
        {data?.channels.length === 0 && <li className="text-sm text-white/60">За период обращений не было.</li>}
        {data?.channels.map((c) => (
          <li key={c.name} className="space-y-1.5">
            <div className="flex items-center gap-2.5 text-sm">
              <ChannelIcon kind={c.kind} size="sm" />
              <span className="min-w-0 flex-1 truncate text-white/85">{CHANNELS[c.kind as ChannelKind]?.short ?? c.name}</span>
              <span className="text-white/60 tabular-nums">{total ? Math.round((c.n / total) * 100) : 0}%</span>
              <span className="w-8 text-right font-medium text-white tabular-nums">{c.n}</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
              <div className="h-full rounded-full" style={{ width: `${total ? (c.n / total) * 100 : 0}%`, background: CHANNELS[c.kind as ChannelKind]?.color ?? "#fff" }} />
            </div>
          </li>
        ))}
      </ul>
    </Glass>
  )
}

function FunnelCard({ data }: { data?: DashboardData }) {
  const rows = (data?.funnel ?? []).filter((f) => isApplicationKind(f.kind))
  const max = Math.max(1, ...rows.map((r) => (r.byStage.new ?? 0) + (r.byStage.review ?? 0) + (r.byStage.in_progress ?? 0)))
  return (
    <Glass className="glass-rise p-6" style={{ animationDelay: "380ms" }}>
      <GlassTitle
        title="Заявки по видам помощи"
        hint={data ? `в работе сейчас и итоги ${data.range.label}` : " "}
        action={
          <div className="hidden items-center gap-3 text-[11px] text-white/60 sm:flex">
            {(["new", "review", "in_progress"] as const).map((s) => (
              <span key={s} className="flex items-center gap-1.5">
                <span className="size-2 rounded-full" style={{ background: STAGE_TONES[s] }} />
                {s === "new" ? "новые" : s === "review" ? "рассмотрение" : "в работе"}
              </span>
            ))}
          </div>
        }
      />
      <ul className="mt-5 space-y-3">
        {rows.map((r) => {
          const meta = APPLICATION_KINDS[r.kind as keyof typeof APPLICATION_KINDS]
          return (
            <li key={r.kind}>
              <Link prefetch={false} href={`/applications?kind=${r.kind}`} className="grid grid-cols-[minmax(0,140px)_minmax(0,1fr)_auto] items-center gap-3 sm:grid-cols-[minmax(0,180px)_minmax(0,1fr)_auto] rounded-xl px-1 py-0.5 hover:bg-white/[0.06]">
                <span className="flex min-w-0 items-center gap-2.5">
                  <KindIcon kind={r.kind} size="sm" className="bg-white/90!" />
                  <span className="truncate text-sm text-white/90">{meta.short}</span>
                </span>
                <span className="flex h-2.5 overflow-hidden rounded-full bg-white/10">
                  {(["new", "review", "in_progress"] as const).map((s) => (
                    <span key={s} style={{ width: `${((r.byStage[s] ?? 0) / max) * 100}%`, background: STAGE_TONES[s] }} />
                  ))}
                </span>
                <span className="w-28 text-right text-xs leading-tight tabular-nums">
                  <span className="block text-white/70">
                    <b className="font-semibold text-white">{r.open}</b> в работе
                  </span>
                  <span className="block text-emerald-200/90">
                    {r.doneInPeriod} · {meta.stages.done.toLowerCase()}
                  </span>
                </span>
              </Link>
            </li>
          )
        })}
      </ul>
    </Glass>
  )
}
