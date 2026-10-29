"use client"

import { Download, KanbanSquare, List, Plus, Search, Siren, Sparkles } from "lucide-react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { useCallback, useEffect, useMemo, useState } from "react"
import { toast } from "sonner"
import useSWR from "swr"
import { ChannelIcon } from "@/components/app/channel-icon"
import { Segmented } from "@/components/app/glass"
import { PageHeader, PageShell } from "@/components/app/page-header"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import type { ApplicationListItem, ApplicationListResponse } from "@/lib/api-types"
import {
  APPLICATION_KIND_ORDER,
  APPLICATION_KINDS,
  fieldText,
  isApplicationKind,
  stageLabel,
  STAGE_LABELS,
  STAGE_ORDER,
  STAGE_TONES,
  type ApplicationKind,
} from "@/lib/applications/catalog"
import type { ApplicationStage } from "@/db/schema"
import { apiFetch } from "@/lib/client"
import { ago, initials, plural, shortTime } from "@/lib/format"
import { cn } from "@/lib/utils"
import { ApplicationSheet } from "./application-sheet"
import { KindIcon } from "./kind-icon"
import { NewApplicationDialog } from "./new-application-dialog"

/** Главное поле анкеты для карточки: где животное, кого берут, город. */
function keyDetail(a: ApplicationListItem) {
  for (const key of ["address", "animal", "region", "period", "delivery", "status"]) {
    const text = fieldText(a.fields[key])
    if (text) return text
  }
  return null
}

function Card({ a, onOpen, dragging, onDragStart }: { a: ApplicationListItem; onOpen: () => void; dragging: boolean; onDragStart: (e: React.DragEvent) => void }) {
  const detail = keyDetail(a)
  return (
    <button
      type="button"
      draggable
      onDragStart={onDragStart}
      onClick={onOpen}
      data-application-card={a.number}
      className={cn(
        "glass-tile group relative w-full overflow-hidden p-3 text-left text-white transition hover:-translate-y-px",
        dragging && "opacity-40",
      )}
    >
      {a.urgent && <span className="absolute inset-y-3 left-0 w-[3px] rounded-full bg-rose-400" aria-hidden />}
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <KindIcon kind={a.kind} size="sm" />
        <span>№{a.number}</span>
        {a.urgent && (
          <span className="inline-flex items-center gap-0.5 rounded-full bg-rose-400/20 px-1.5 py-0.5 font-medium text-rose-200">
            <Siren className="size-3" /> срочно
          </span>
        )}
        <span className="ml-auto tabular-nums">{shortTime(a.createdAt)}</span>
      </div>
      <p className="mt-2 line-clamp-2 text-sm leading-snug font-medium">{a.title}</p>
      {detail && <p className="mt-1 line-clamp-1 text-xs text-muted-foreground">{detail}</p>}
      <div className="mt-3 flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-xs">{a.contact?.name ?? "Без имени"}</span>
        {a.channelKind && <ChannelIcon kind={a.channelKind} size="xs" />}
        {a.assignee?.name ? (
          <Avatar className="size-5" title={a.assignee.name}>
            <AvatarFallback className="bg-white/15 text-[9px] text-white">{initials(a.assignee.name)}</AvatarFallback>
          </Avatar>
        ) : (
          <span className="size-5 rounded-full border border-dashed border-white/30" title="Не назначен" />
        )}
      </div>
    </button>
  )
}

export function ApplicationsView() {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const kind = isApplicationKind(params.get("kind")) ? (params.get("kind") as ApplicationKind) : null
  const view = params.get("view") === "list" ? "list" : "board"
  const mine = params.get("assignee") === "me"
  const urgentOnly = params.get("urgent") === "1"
  const state = params.get("state") ?? "open"
  const openId = params.get("id")
  const [query, setQuery] = useState(params.get("q") ?? "")
  const [debounced, setDebounced] = useState(query)
  const [creating, setCreating] = useState(false)
  const [dragId, setDragId] = useState<string | null>(null)
  const [overStage, setOverStage] = useState<ApplicationStage | null>(null)

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query.trim()), 250)
    return () => clearTimeout(timer)
  }, [query])

  const hrefFor = useCallback(
    (patch: Record<string, string | null>) => {
      const next = new URLSearchParams(params.toString())
      for (const [k, v] of Object.entries(patch)) {
        if (v === null) next.delete(k)
        else next.set(k, v)
      }
      const qs = next.toString()
      return qs ? `${pathname}?${qs}` : pathname
    },
    [params, pathname],
  )
  const go = (patch: Record<string, string | null>) => router.replace(hrefFor(patch), { scroll: false })

  const filterQs = new URLSearchParams({
    ...(kind ? { kind } : {}),
    ...(mine ? { assignee: "me" } : {}),
    ...(urgentOnly ? { urgent: "1" } : {}),
    ...(debounced ? { q: debounced } : {}),
  })
  const listKey = `/api/applications?${new URLSearchParams({
    ...Object.fromEntries(filterQs),
    ...(view === "board" ? { state: "all", closedWithin: "30" } : { state }),
  })}`
  const { data, mutate } = useSWR<ApplicationListResponse>(listKey)
  const items = useMemo(() => data?.items ?? [], [data])

  const columns = useMemo(() => {
    const map = new Map<ApplicationStage, ApplicationListItem[]>(STAGE_ORDER.map((s) => [s, []]))
    for (const a of items) map.get(a.stage)?.push(a)
    return map
  }, [items])

  async function move(appId: string, stage: ApplicationStage) {
    const app = items.find((a) => a.id === appId)
    if (!app || app.stage === stage) return
    const label = stageLabel(app.kind, stage)
    await mutate(
      async (current) => {
        await apiFetch(`/api/applications/${appId}`, { method: "PATCH", json: { stage } })
        return current
      },
      {
        optimisticData: (current) => (current ? { ...current, items: current.items.map((a) => (a.id === appId ? { ...a, stage } : a)) } : current!),
        rollbackOnError: true,
        revalidate: true,
      },
    ).then(
      () =>
        toast.success(`№${app.number}: «${label}»`, {
          action: stage === "done" || stage === "declined" ? { label: "Добавить итог", onClick: () => go({ id: appId }) } : undefined,
        }),
      (err: Error) => toast.error(err.message),
    )
  }

  const openCount = Object.values(data?.byKind ?? {}).reduce((s, n) => s + n, 0)

  return (
    <PageShell fill>
      <PageHeader
        title="Заявки"
        description={
          <span className="flex flex-wrap items-center gap-x-2">
            Из всех каналов: ассистент оформляет их сам, сотрудник ведёт до итога.
            {data && data.items.some((a) => a.source === "ai") && (
              <span className="inline-flex items-center gap-1 text-white/80">
                <Sparkles className="size-3.5 text-[#05c7f2]" /> {data.items.filter((a) => a.source === "ai").length} от ассистента
              </span>
            )}
          </span>
        }
        actions={
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
            <a
              className="glass-chip inline-flex items-center gap-2 rounded-full px-4 py-2.5 text-sm"
              href={`/api/applications/export?${new URLSearchParams({ ...Object.fromEntries(filterQs), state: view === "board" ? "all" : state })}`}
            >
              <Download className="size-4" /> Выгрузить
            </a>
            <Button className="h-10 rounded-full px-4" onClick={() => setCreating(true)}>
              <Plus /> Новая заявка
            </Button>
          </div>
        }
      />

      <div className="space-y-3">
        <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1 scroll-thin" role="tablist" aria-label="Вид заявки">
          <KindTab active={!kind} onClick={() => go({ kind: null })} label="Все" count={openCount} />
          {APPLICATION_KIND_ORDER.map((k) => (
            <KindTab key={k} kind={k} active={kind === k} onClick={() => go({ kind: k })} label={APPLICATION_KINDS[k].short} count={data?.byKind[k] ?? 0} />
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative w-full max-w-xs">
            <Search className="pointer-events-none absolute top-1/2 left-3.5 z-10 size-4 -translate-y-1/2 text-white/60" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Имя, телефон, адрес, №"
              className="glass-chip h-10 rounded-full border-white/15 pl-10 placeholder:text-white/45"
              aria-label="Поиск по заявкам"
            />
          </div>
          <Toggle active={mine} onClick={() => go({ assignee: mine ? null : "me" })}>
            Мои
          </Toggle>
          <Toggle active={urgentOnly} onClick={() => go({ urgent: urgentOnly ? null : "1" })}>
            <Siren className="size-3.5" /> Срочные
          </Toggle>
          {view === "list" && (
            <Segmented
              label="Открытые или закрытые"
              value={state as "open" | "closed" | "all"}
              onChange={(v) => go({ state: v === "open" ? null : v })}
              options={[
                { id: "open", label: "Открытые" },
                { id: "closed", label: "Закрытые" },
                { id: "all", label: "Все" },
              ]}
            />
          )}
          <div className="ml-auto">
            <Segmented
              label="Вид"
              value={view}
              onChange={(v) => go({ view: v === "board" ? null : v })}
              options={[
                { id: "board", label: <><KanbanSquare /> Доска</> },
                { id: "list", label: <><List /> Список</> },
              ]}
            />
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1">
        {!data ? (
          <div className="grid grid-cols-5 gap-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-72 rounded-[26px]" />
            ))}
          </div>
        ) : view === "board" ? (
          <div className="grid h-full min-h-0 auto-cols-[minmax(232px,1fr)] grid-flow-col gap-3 overflow-x-auto pb-1 scroll-thin">
            {STAGE_ORDER.map((stage) => {
              const list = columns.get(stage) ?? []
              return (
                <section
                  key={stage}
                  data-stage={stage}
                  onDragOver={(e) => {
                    if (!dragId) return
                    e.preventDefault()
                    setOverStage(stage)
                  }}
                  onDragLeave={() => setOverStage((s) => (s === stage ? null : s))}
                  onDrop={(e) => {
                    e.preventDefault()
                    setOverStage(null)
                    const id = e.dataTransfer.getData("text/application") || dragId
                    setDragId(null)
                    if (id) void move(id, stage)
                  }}
                  className={cn(
                    "glass-panel flex min-h-0 flex-col transition-shadow",
                    overStage === stage && "ring-2 ring-[#05c7f2]/70",
                  )}
                >
                  <header className="flex items-center gap-2 px-3 pt-3 pb-2">
                    <span className="size-2 rounded-full" style={{ background: STAGE_TONES[stage] }} />
                    <h2 className="text-sm font-semibold text-white">{kind ? APPLICATION_KINDS[kind].stages[stage] : STAGE_LABELS[stage]}</h2>
                    <span className="ml-auto rounded-full bg-white/10 px-2 py-0.5 text-xs text-white/70 tabular-nums">{list.length}</span>
                  </header>
                  {(stage === "done" || stage === "declined") && <p className="px-3 pb-1 text-[11px] text-muted-foreground">за последние 30 дней</p>}
                  <div className="min-h-24 flex-1 space-y-2 overflow-y-auto px-2 pb-3 scroll-thin">
                    {list.map((a) => (
                      <Card
                        key={a.id}
                        a={a}
                        dragging={dragId === a.id}
                        onOpen={() => go({ id: a.id })}
                        onDragStart={(e) => {
                          e.dataTransfer.setData("text/application", a.id)
                          e.dataTransfer.effectAllowed = "move"
                          setDragId(a.id)
                        }}
                      />
                    ))}
                    {list.length === 0 && <p className="px-2 py-6 text-center text-xs text-muted-foreground">{stage === "new" ? "Новых заявок нет" : "Пусто"}</p>}
                  </div>
                </section>
              )
            })}
          </div>
        ) : (
          <ListTable items={items} onOpen={(id) => go({ id })} />
        )}
      </div>

      <ApplicationSheet id={openId} onClose={() => go({ id: null })} />
      <NewApplicationDialog
        open={creating}
        onOpenChange={setCreating}
        defaultKind={kind}
        onCreated={(app) => {
          void mutate()
          go({ id: app.id })
        }}
      />
    </PageShell>
  )
}

function KindTab({ kind, label, count, active, onClick }: { kind?: ApplicationKind; label: string; count: number; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        "flex shrink-0 items-center gap-2 rounded-full border px-3 py-1.5 text-sm backdrop-blur-xl transition-colors",
        active ? "border-white bg-white text-[#0c143b]" : "border-white/15 bg-white/[0.08] text-white/85 hover:bg-white/[0.14]",
      )}
    >
      {kind && <KindIcon kind={kind} size="sm" />}
      {label}
      <span className={cn("tabular-nums", active ? "text-[#0c143b]/55" : "text-white/50")}>{count}</span>
    </button>
  )
}

function Toggle({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "glass-chip flex h-10 items-center gap-1.5 rounded-full px-4 text-sm",
        active && "bg-white! font-medium text-[#0c143b]!",
      )}
    >
      {children}
    </button>
  )
}

function ListTable({ items, onOpen }: { items: ApplicationListItem[]; onOpen: (id: string) => void }) {
  if (!items.length) return <p className="py-16 text-center text-sm text-muted-foreground">Заявок по этим условиям нет.</p>
  return (
    <div className="glass-panel h-full overflow-auto scroll-thin">
      <table className="w-full min-w-[820px] text-sm">
        <thead className="sticky top-0 z-10 bg-[#0d1530]/80 text-left text-xs text-white/55 backdrop-blur-xl">
          <tr>
            <th className="px-3 py-2 font-medium">№</th>
            <th className="px-3 py-2 font-medium">Заявка</th>
            <th className="px-3 py-2 font-medium">Человек</th>
            <th className="px-3 py-2 font-medium">Этап</th>
            <th className="px-3 py-2 font-medium">Ответственный</th>
            <th className="px-3 py-2 font-medium">Создана</th>
          </tr>
        </thead>
        <tbody>
          {items.map((a) => (
            <tr key={a.id} onClick={() => onOpen(a.id)} className="cursor-pointer border-t border-white/[0.07] hover:bg-white/[0.06]">
              <td className="px-3 py-2.5 text-muted-foreground tabular-nums">{a.number}</td>
              <td className="px-3 py-2.5">
                <div className="flex items-center gap-2">
                  <KindIcon kind={a.kind} size="sm" />
                  <span className="line-clamp-1 font-medium">{a.title}</span>
                  {a.urgent && <Siren className="size-3.5 shrink-0 text-red-500" aria-label="срочно" />}
                </div>
              </td>
              <td className="px-3 py-2.5">
                <div className="line-clamp-1">{a.contact?.name ?? "—"}</div>
                <div className="text-xs text-muted-foreground">{a.contact?.phone ?? a.contact?.email ?? ""}</div>
              </td>
              <td className="px-3 py-2.5">
                <span className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium" style={{ background: `color-mix(in oklab, ${STAGE_TONES[a.stage]} 15%, transparent)` }}>
                  <span className="size-1.5 rounded-full" style={{ background: STAGE_TONES[a.stage] }} />
                  {stageLabel(a.kind, a.stage)}
                </span>
              </td>
              <td className="px-3 py-2.5 text-muted-foreground">{a.assignee?.name ?? "—"}</td>
              <td className="px-3 py-2.5 text-muted-foreground" title={new Date(a.createdAt).toLocaleString("ru-RU")}>
                {ago(a.createdAt)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="border-t border-white/[0.07] px-3 py-2 text-xs text-muted-foreground">
        {items.length} {plural(items.length, "заявка", "заявки", "заявок")}
      </p>
    </div>
  )
}
