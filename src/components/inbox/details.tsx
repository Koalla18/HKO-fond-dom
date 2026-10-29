"use client"

import { Bot, ClipboardPlus, ExternalLink, Loader2, Mail, Pencil, Phone, Sparkles } from "lucide-react"
import Link from "next/link"
import { useState } from "react"
import { toast } from "sonner"
import useSWR from "swr"
import { ChannelIcon } from "@/components/app/channel-icon"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { KindIcon } from "@/components/applications/kind-icon"
import { NewApplicationDialog } from "@/components/applications/new-application-dialog"
import type { ApplicationListResponse, RequestDetail, TeamUser } from "@/lib/api-types"
import { kindForCategory, stageLabel, STAGE_TONES } from "@/lib/applications/catalog"
import { CHANNELS, DEFAULT_CATEGORIES, PRIORITY_LABELS, STATUS_LABELS, type ChannelKind } from "@/lib/channels/catalog"
import { apiFetch } from "@/lib/client"
import { fullTime, shortTime } from "@/lib/format"
import { StatusDot } from "./status"

const NONE = "__none__"

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[96px_1fr] items-center gap-2 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <div className="min-w-0">{children}</div>
    </div>
  )
}

function Section({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section className="space-y-3 border-b border-white/10 px-4 py-4 last:border-b-0">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  )
}

export function Details({ detail, onChanged, hrefFor }: { detail: RequestDetail; onChanged: () => void; hrefFor: (patch: Record<string, string | null>) => string }) {
  const { request, contact, channel } = detail
  const { data: team } = useSWR<{ users: TeamUser[] }>("/api/users")
  const meta = CHANNELS[channel.kind as ChannelKind]
  const [editing, setEditing] = useState(false)
  const [applying, setApplying] = useState(false)
  const [analyzing, setAnalyzing] = useState(false)
  async function analyze() {
    setAnalyzing(true)
    try {
      const res = await apiFetch<{ actions: string[] }>(`/api/requests/${request.id}/agent`, { method: "POST" })
      toast.success(res.actions.includes("application") ? "Ассистент разобрал обращение и оформил заявку" : "Ассистент разобрал обращение")
      onChanged()
      void mutateApps()
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setAnalyzing(false)
    }
  }
  const { data: apps, mutate: mutateApps } = useSWR<ApplicationListResponse>(`/api/applications?request=${request.id}&state=all`)

  async function patch(body: Record<string, unknown>) {
    try {
      await apiFetch(`/api/requests/${request.id}`, { method: "PATCH", json: body })
      onChanged()
    } catch (err) {
      toast.error((err as Error).message)
    }
  }

  const categories = Array.from(new Set([...DEFAULT_CATEGORIES, ...(request.category ? [request.category] : [])]))

  return (
    <aside className="h-full min-h-0 overflow-y-auto scroll-thin">
      <Section title="Откуда пришла">
        <div className="glass-tile flex items-center gap-3 p-3">
          <ChannelIcon kind={channel.kind} size="lg" />
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{meta?.title ?? channel.kind}</p>
            <p className="truncate text-xs text-muted-foreground">{channel.name}</p>
            <p className="text-xs text-muted-foreground">{fullTime(request.createdAt)}</p>
          </div>
        </div>
      </Section>

      <Section title="Обращение">
        <div className="space-y-2.5">
          <Field label="Статус">
            <Select value={request.status} onValueChange={(v) => patch({ status: v })}>
              <SelectTrigger size="sm" className="w-full" aria-label="Статус">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(STATUS_LABELS).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    <StatusDot status={value as keyof typeof STATUS_LABELS} /> {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Срочность">
            <Select value={request.priority} onValueChange={(v) => patch({ priority: v })}>
              <SelectTrigger size="sm" className="w-full" aria-label="Срочность">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(PRIORITY_LABELS).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Категория">
            <Select value={request.category ?? NONE} onValueChange={(v) => patch({ category: v === NONE ? null : v })}>
              <SelectTrigger size="sm" className="w-full" aria-label="Категория">
                <SelectValue placeholder="Не выбрана" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>Не выбрана</SelectItem>
                {categories.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Ответственный">
            <Select value={request.assigneeId ?? NONE} onValueChange={(v) => patch({ assigneeId: v === NONE ? null : v })}>
              <SelectTrigger size="sm" className="w-full" aria-label="Ответственный">
                <SelectValue placeholder="Не назначен" />
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
          </Field>
        </div>
        <div className="rounded-2xl border border-dashed border-white/15 bg-white/[0.04] p-3 text-xs">
          <div className="mb-1 flex items-center gap-1.5 font-medium text-foreground">
            <Sparkles className="size-3.5 text-primary" /> Суть обращения
          </div>
          {request.summary ? (
            <p className="text-sm whitespace-pre-wrap text-foreground">{request.summary}</p>
          ) : (
            <p className="text-muted-foreground">Тему, срочность и суть заполняет ассистент — сам на каждое сообщение или по кнопке.</p>
          )}
          <div className="mt-2 flex flex-wrap gap-1.5">
            <Button size="xs" variant="outline" disabled={analyzing} onClick={analyze}>
              {analyzing ? <Loader2 className="animate-spin" /> : <Sparkles />} Разобрать ассистентом
            </Button>
            {request.aiHandling && (
              <Button size="xs" variant="outline" onClick={() => patch({ aiHandling: false })}>
                <Bot /> Забрать у ассистента
              </Button>
            )}
          </div>
        </div>
      </Section>

      <Section
        title="Заявки"
        action={
          <Button size="xs" variant="outline" onClick={() => setApplying(true)}>
            <ClipboardPlus /> Оформить
          </Button>
        }
      >
        {!apps?.items.length ? (
          <p className="text-xs text-muted-foreground">
            Если человек хочет взять питомца, нашёл животное, готов к передержке или волонтёрству — оформите заявку: она появится на доске «Заявки».
          </p>
        ) : (
          <ul className="space-y-1.5">
            {apps.items.map((a) => (
              <li key={a.id}>
                <Link prefetch={false} href={`/applications?id=${a.id}`} className="glass-tile flex items-center gap-2 px-2.5 py-2 text-sm">
                  <KindIcon kind={a.kind} size="sm" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{a.title}</span>
                    <span className="flex items-center gap-1 text-xs text-muted-foreground">
                      <span className="size-1.5 rounded-full" style={{ background: STAGE_TONES[a.stage] }} />№{a.number} · {stageLabel(a.kind, a.stage)}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
        <NewApplicationDialog
          open={applying}
          onOpenChange={setApplying}
          request={{ id: request.id, contactName: contact.name, category: request.category }}
          defaultKind={kindForCategory(request.category)}
          onCreated={() => {
            void mutateApps()
            onChanged()
          }}
        />
      </Section>

      <Section
        title="Человек"
        action={
          <Button size="icon-xs" variant="ghost" onClick={() => setEditing((v) => !v)} aria-label="Изменить данные человека">
            <Pencil />
          </Button>
        }
      >
        {editing ? (
          <ContactForm detail={detail} onDone={() => (setEditing(false), onChanged())} />
        ) : (
          <div className="space-y-2 text-sm">
            <p className="font-medium">{contact.name}</p>
            {contact.phone && (
              <a href={`tel:${contact.phone}`} className="flex items-center gap-2 text-foreground/80 hover:text-primary">
                <Phone className="size-3.5" /> {contact.phone}
              </a>
            )}
            {contact.email && (
              <a href={`mailto:${contact.email}`} className="flex items-center gap-2 break-all text-foreground/80 hover:text-primary">
                <Mail className="size-3.5 shrink-0" /> {contact.email}
              </a>
            )}
            {contact.note && <p className="rounded-xl bg-white/[0.07] px-2.5 py-2 text-xs whitespace-pre-wrap">{contact.note}</p>}
            <div className="space-y-1.5 pt-1">
              <p className="text-xs text-muted-foreground">Пишет нам через:</p>
              {detail.identities.map((id) => (
                <div key={id.id} className="flex items-center gap-2 text-xs">
                  <ChannelIcon kind={id.channel.kind} size="xs" />
                  <span className="min-w-0 flex-1 truncate">
                    {id.handle ? `@${id.handle.replace(/^@/, "")}` : id.externalId.startsWith("visitor:") ? "посетитель сайта" : id.externalId}
                  </span>
                  {id.profileUrl && (
                    <a href={id.profileUrl} target="_blank" rel="noreferrer" className="text-muted-foreground hover:text-primary" aria-label="Открыть профиль">
                      <ExternalLink className="size-3.5" />
                    </a>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </Section>

      <Section title={`Другие обращения · ${detail.history.length}`}>
        {detail.history.length === 0 ? (
          <p className="text-xs text-muted-foreground">Первое обращение этого человека.</p>
        ) : (
          <ul className="space-y-1.5">
            {detail.history.map((h) => (
              <li key={h.id}>
                <Link prefetch={false} href={hrefFor({ id: h.id, view: "all" })} className="flex gap-2 rounded-xl p-2 text-xs hover:bg-white/[0.08]">
                  <ChannelIcon kind={h.channel.kind} size="xs" className="mt-0.5" />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5 font-medium">
                      #{h.number} <StatusDot status={h.status} /> <span className="font-normal text-muted-foreground">{shortTime(h.createdAt)}</span>
                    </span>
                    <span className="line-clamp-2 text-muted-foreground">{h.subject ?? h.lastMessagePreview}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </aside>
  )
}

function ContactForm({ detail, onDone }: { detail: RequestDetail; onDone: () => void }) {
  const { contact, request } = detail
  const [busy, setBusy] = useState(false)
  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const f = new FormData(e.currentTarget)
    setBusy(true)
    try {
      await apiFetch(`/api/requests/${request.id}`, {
        method: "PATCH",
        json: {
          contactName: String(f.get("name") ?? "").trim() || contact.name,
          contactPhone: String(f.get("phone") ?? "").trim() || null,
          contactEmail: String(f.get("email") ?? "").trim() || null,
          contactNote: String(f.get("note") ?? "").trim() || null,
        },
      })
      onDone()
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <form onSubmit={onSubmit} className="space-y-2">
      <Input name="name" defaultValue={contact.name} placeholder="Имя" aria-label="Имя" />
      <Input name="phone" defaultValue={contact.phone ?? ""} placeholder="Телефон" aria-label="Телефон" />
      <Input name="email" defaultValue={contact.email ?? ""} placeholder="Почта" aria-label="Почта" />
      <Textarea name="note" defaultValue={contact.note ?? ""} placeholder="Заметка о человеке (видят только сотрудники)" aria-label="Заметка" />
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={busy}>
          Сохранить
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onDone}>
          Отмена
        </Button>
      </div>
    </form>
  )
}
