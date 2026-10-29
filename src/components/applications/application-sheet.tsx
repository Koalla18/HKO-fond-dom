"use client"

import { Bot, Check, Mail, MessageSquareText, Pencil, Phone, Siren } from "lucide-react"
import Link from "next/link"
import { useState } from "react"
import { toast } from "sonner"
import useSWR from "swr"
import { ChannelIcon } from "@/components/app/channel-icon"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet"
import { Skeleton } from "@/components/ui/skeleton"
import { Textarea } from "@/components/ui/textarea"
import type { ApplicationDetail, ApplicationEventItem, TeamUser } from "@/lib/api-types"
import { APPLICATION_KINDS, isApplicationKind, stageLabel, STAGE_TONES, type ApplicationKind } from "@/lib/applications/catalog"
import { apiFetch } from "@/lib/client"
import type { ApplicationStage } from "@/db/schema"
import { ago, fullTime } from "@/lib/format"
import { cn } from "@/lib/utils"
import { FieldsEditor, FieldsView, type FieldValues } from "./fields"
import { KindIcon } from "./kind-icon"

const NONE = "__none__"
const SOURCE_LABELS: Record<string, string> = { site: "анкета", form: "форма сайта фонда", inbox: "из обращения", manual: "заведена вручную", ai: "оформил ассистент" }
const FLOW: ApplicationStage[] = ["new", "review", "in_progress", "done"]

export function ApplicationSheet({ id, onClose }: { id: string | null; onClose: () => void }) {
  return (
    <Sheet open={Boolean(id)} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full gap-0 overflow-hidden p-0 data-[side=right]:sm:top-3 data-[side=right]:sm:right-3 data-[side=right]:sm:h-[calc(100%-1.5rem)] data-[side=right]:sm:max-w-xl data-[side=right]:sm:rounded-[26px] data-[side=right]:sm:border">{id && <Body key={id} id={id} />}</SheetContent>
    </Sheet>
  )
}

function Body({ id }: { id: string }) {
  const { data, mutate, error } = useSWR<ApplicationDetail>(`/api/applications/${id}`)
  const { data: team } = useSWR<{ users: TeamUser[] }>("/api/users")
  const [editing, setEditing] = useState<FieldValues | null>(null)
  const [closing, setClosing] = useState<ApplicationStage | null>(null)
  const [outcome, setOutcome] = useState("")
  const [note, setNote] = useState("")
  const [busy, setBusy] = useState(false)

  if (error) return <p className="p-6 text-sm text-muted-foreground">Заявка не найдена — возможно, её удалили.</p>
  if (!data) {
    return (
      <div className="space-y-4 p-6">
        <SheetTitle className="sr-only">Заявка</SheetTitle>
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    )
  }

  const { application: app, request, events, related } = data
  const kind = (isApplicationKind(app.kind) ? app.kind : "found") as ApplicationKind
  const meta = APPLICATION_KINDS[kind]

  async function patch(body: Record<string, unknown>, done?: string) {
    setBusy(true)
    try {
      await apiFetch(`/api/applications/${id}`, { method: "PATCH", json: body })
      await mutate()
      if (done) toast.success(done)
      return true
    } catch (err) {
      toast.error((err as Error).message)
      return false
    } finally {
      setBusy(false)
    }
  }

  function chooseStage(stage: ApplicationStage) {
    if (stage === app.stage) return
    if (stage === "done" || stage === "declined") {
      setClosing(stage)
      setOutcome(app.outcome ?? "")
      return
    }
    void patch({ stage }, `Этап: «${meta.stages[stage]}»`)
  }

  const flowIndex = FLOW.indexOf(app.stage)

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="space-y-4 border-b border-white/10 p-5 pr-12">
        <div className="flex items-center gap-3">
          <KindIcon kind={kind} />
          <div className="min-w-0 text-xs text-muted-foreground">
            <span className="font-medium text-foreground">{meta.title}</span> · №{app.number} ·{" "}
            {app.source === "ai" ? (
              <span className="inline-flex items-center gap-1 text-[#7ee3fa]">
                <Bot className="size-3.5" /> оформил ассистент
              </span>
            ) : (
              (SOURCE_LABELS[app.source] ?? app.source)
            )}
          </div>
          <button
            type="button"
            onClick={() => patch({ urgent: !app.urgent }, app.urgent ? "Срочность снята" : "Отмечено как срочное")}
            className={cn(
              "ml-auto inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium transition-colors",
              app.urgent ? "bg-rose-500 text-white" : "bg-white/10 text-white/70 hover:bg-rose-400/20 hover:text-rose-100",
            )}
          >
            <Siren className="size-3.5" /> {app.urgent ? "Срочно" : "Не срочно"}
          </button>
        </div>
        <SheetTitle className="text-xl leading-snug font-semibold">{app.title}</SheetTitle>
        <SheetDescription className="sr-only">Карточка заявки №{app.number}</SheetDescription>

        <div className="space-y-2">
          <div className="flex gap-1" role="group" aria-label="Этап заявки">
            {FLOW.map((stage, i) => {
              const reached = app.stage !== "declined" && i <= flowIndex
              const current = app.stage === stage
              return (
                <button
                  key={stage}
                  type="button"
                  disabled={busy}
                  onClick={() => chooseStage(stage)}
                  aria-current={current ? "step" : undefined}
                  className={cn(
                    "flex min-w-0 flex-1 items-center justify-center gap-1 rounded-lg border px-1.5 py-2 text-xs font-medium transition-colors",
                    reached ? "border-transparent text-[#04192b]" : "border-white/12 bg-white/[0.05] text-white/60 hover:bg-white/10 hover:text-white",
                  )}
                  style={reached ? { background: STAGE_TONES[stage] } : undefined}
                >
                  {reached && !current && <Check className="size-3.5 shrink-0" />}
                  <span className="truncate">{meta.stages[stage]}</span>
                </button>
              )
            })}
          </div>
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">
              На этапе «{stageLabel(kind, app.stage)}» {ago(app.stageChangedAt).replace(/ назад$/, "")}
            </span>
            {app.stage === "declined" ? (
              <button type="button" className="text-primary hover:underline" onClick={() => patch({ stage: "review" }, "Заявка снова в работе")}>
                Вернуть в работу
              </button>
            ) : (
              <button type="button" className="text-muted-foreground hover:text-destructive" onClick={() => chooseStage("declined")}>
                {meta.stages.declined}…
              </button>
            )}
          </div>
          {closing && (
            <div className="glass-tile space-y-2 p-3">
              <p className="text-sm font-medium">{closing === "done" ? `«${meta.stages.done}» — чем закончилось?` : "Почему не получилось?"}</p>
              <Textarea
                autoFocus
                rows={2}
                value={outcome}
                onChange={(e) => setOutcome(e.target.value)}
                placeholder={closing === "done" ? "Например: Барс уехал в семью в Химки, договор подписан" : "Например: нет условий для собаки, предложили передержку"}
              />
              <div className="flex justify-end gap-2">
                <Button size="sm" variant="ghost" onClick={() => setClosing(null)}>
                  Отмена
                </Button>
                <Button
                  size="sm"
                  variant={closing === "declined" ? "destructive" : "default"}
                  disabled={busy}
                  onClick={async () => {
                    if (await patch({ stage: closing, outcome: outcome || null }, `Этап: «${meta.stages[closing]}»`)) setClosing(null)
                  }}
                >
                  {closing === "done" ? meta.stages.done : meta.stages.declined}
                </Button>
              </div>
            </div>
          )}
        </div>
      </header>

      <div className="min-h-0 flex-1 space-y-6 overflow-y-auto p-5 scroll-thin">
        <section className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <span className="text-xs text-muted-foreground">Ответственный</span>
            <Select value={app.assignee?.id ?? NONE} onValueChange={(v) => patch({ assigneeId: v === NONE ? null : v })}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>Не назначен</SelectItem>
                {team?.users
                  .filter((u) => u.active)
                  .map((u) => (
                    <SelectItem key={u.id} value={u.id}>
                      {u.name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <span className="text-xs text-muted-foreground">Создана</span>
            <p className="py-1.5 text-sm">{fullTime(app.createdAt)}</p>
          </div>
        </section>

        {app.outcome && (
          <section className="rounded-2xl border-l-4 bg-white/[0.06] p-3 text-sm" style={{ borderColor: STAGE_TONES[app.stage] }}>
            <p className="text-xs text-muted-foreground">Итог</p>
            <p className="whitespace-pre-wrap">{app.outcome}</p>
          </section>
        )}

        <section className="space-y-3">
          <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Человек</h3>
          <div className="glass-tile space-y-2 p-3">
            <p className="font-medium">{app.contact?.name ?? "Без имени"}</p>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
              {app.contact?.phone && (
                <a href={`tel:${app.contact.phone}`} className="flex items-center gap-1.5 text-primary hover:underline">
                  <Phone className="size-3.5" /> {app.contact.phone}
                </a>
              )}
              {app.contact?.email && (
                <a href={`mailto:${app.contact.email}`} className="flex items-center gap-1.5 text-primary hover:underline">
                  <Mail className="size-3.5" /> {app.contact.email}
                </a>
              )}
              {!app.contact?.phone && !app.contact?.email && <span className="text-muted-foreground">Контактов нет — пишите в переписку</span>}
            </div>
            {request && (
              <Link
                prefetch={false}
                href={`/inbox?id=${request.id}&view=all`}
                className="mt-1 flex items-center gap-2 rounded-xl bg-white/[0.08] px-3 py-2 text-sm hover:bg-white/[0.14]"
              >
                <ChannelIcon kind={request.channel.kind} size="sm" />
                <span className="min-w-0 flex-1 truncate">
                  Переписка: обращение №{request.number}
                  {request.subject ? ` · ${request.subject}` : ""}
                </span>
                <MessageSquareText className="size-4 text-muted-foreground" />
              </Link>
            )}
          </div>
        </section>

        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Анкета</h3>
            {!editing ? (
              <Button size="sm" variant="ghost" onClick={() => setEditing({ ...app.fields })}>
                <Pencil /> Изменить
              </Button>
            ) : (
              <div className="flex gap-1">
                <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>
                  Отмена
                </Button>
                <Button
                  size="sm"
                  disabled={busy}
                  onClick={async () => {
                    if (await patch({ fields: editing }, "Анкета сохранена")) setEditing(null)
                  }}
                >
                  Сохранить
                </Button>
              </div>
            )}
          </div>
          {editing ? <FieldsEditor kind={kind} values={editing} onChange={setEditing} /> : <FieldsView kind={kind} values={app.fields} />}
        </section>

        {related.length > 0 && (
          <section className="space-y-2">
            <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Другие заявки человека</h3>
            <ul className="space-y-1.5">
              {related.map((r) => (
                <li key={r.id}>
                  <Link prefetch={false} href={`/applications?id=${r.id}`} className="flex items-center gap-2 rounded-xl px-2 py-1.5 text-sm hover:bg-white/[0.08]">
                    <KindIcon kind={r.kind} size="sm" />
                    <span className="min-w-0 flex-1 truncate">
                      №{r.number} · {r.title}
                    </span>
                    <span className="text-xs text-muted-foreground">{stageLabel(r.kind, r.stage as ApplicationStage)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="space-y-3">
          <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">История</h3>
          <ol className="relative space-y-3 border-l border-white/15 pl-4">
            {events.map((e) => (
              <li key={e.id} className="relative">
                <span className="absolute top-1.5 -left-[21px] size-2.5 rounded-full border-2 border-[#131b33]" style={{ background: eventTone(e) }} />
                <p className="text-sm">{eventText(kind, e)}</p>
                {e.type === "note" && e.text && <p className="mt-1 rounded-xl border border-amber-300/25 bg-amber-300/10 px-3 py-2 text-sm whitespace-pre-wrap text-amber-50">{e.text}</p>}
                {e.type === "stage" && e.text && <p className="mt-1 text-sm whitespace-pre-wrap text-muted-foreground">«{e.text}»</p>}
                <p className="text-xs text-muted-foreground">
                  {e.authorName ?? (e.authorType === "ai" ? "Ассистент" : e.authorType === "contact" ? "Человек" : "Система")} · {fullTime(e.createdAt)}
                </p>
              </li>
            ))}
          </ol>
          <form
            className="flex gap-2"
            onSubmit={async (ev) => {
              ev.preventDefault()
              if (note.trim() && (await patch({ note }))) setNote("")
            }}
          >
            <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Заметка для команды: позвонили, договорились о встрече…" />
            <Button type="submit" variant="outline" disabled={!note.trim() || busy}>
              Добавить
            </Button>
          </form>
        </section>

      </div>
    </div>
  )
}

function eventTone(e: ApplicationEventItem) {
  if (e.type === "stage" && e.toStage) return STAGE_TONES[e.toStage as ApplicationStage] ?? "#94a3b8"
  if (e.type === "created") return STAGE_TONES.new
  if (e.type === "note") return "#f59e0b"
  return "#94a3b8"
}

function eventText(kind: ApplicationKind, e: ApplicationEventItem) {
  const meta = APPLICATION_KINDS[kind]
  if (e.type === "created") return "Заявка создана"
  if (e.type === "stage") return `Этап: ${e.fromStage ? `«${meta.stages[e.fromStage as ApplicationStage]}» → ` : ""}«${meta.stages[e.toStage as ApplicationStage] ?? e.toStage}»`
  if (e.type === "note") return "Заметка"
  return e.text ?? "Изменения"
}
