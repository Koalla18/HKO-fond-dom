"use client"

import { Building2, KeyRound, Loader2, Sparkles, UserPlus, Users } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"
import useSWR from "swr"
import { Glass } from "@/components/app/glass"
import { PageHeader, PageShell } from "@/components/app/page-header"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import type { MeResponse, TeamUser } from "@/lib/api-types"
import { AI_PRESETS, presetOf } from "@/lib/agent/presets"
import { APPLICATION_KINDS, fieldText, isApplicationKind } from "@/lib/applications/catalog"
import { cn } from "@/lib/utils"
import type { AiSettings, ApplicationSettings } from "@/lib/settings"
import { apiFetch } from "@/lib/client"

type Settings = { org: MeResponse["org"]; ai: AiSettings; aiKeyMask: string | null; applications: ApplicationSettings }

function Card({ title, description, icon, children, delay = 0 }: { title: string; description?: string; icon?: React.ReactNode; children: React.ReactNode; delay?: number }) {
  return (
    <Glass className="glass-rise overflow-hidden" style={{ animationDelay: `${delay}ms` }}>
      <div className="flex items-start gap-3 border-b border-white/10 px-6 py-5">
        {icon}
        <div className="space-y-1">
          <h2 className="text-[15px] font-semibold">{title}</h2>
          {description && <p className="max-w-3xl text-sm text-white/60">{description}</p>}
        </div>
      </div>
      <div className="p-6">{children}</div>
    </Glass>
  )
}

export function SettingsView({ meId }: { meId: string }) {
  const { data, mutate } = useSWR<Settings>("/api/settings")
  const { data: team, mutate: mutateTeam } = useSWR<{ users: TeamUser[] }>("/api/users")
  // null — поле не трогали, показываем сохранённое значение.
  const [orgNameDraft, setOrgName] = useState<string | null>(null)
  const orgName = orgNameDraft ?? data?.org.name ?? ""
  const [inviteOpen, setInviteOpen] = useState(false)

  async function save(body: Record<string, unknown>, message = "Сохранено") {
    try {
      await apiFetch("/api/settings", { method: "PATCH", json: body })
      toast.success(message)
      await mutate()
      return true
    } catch (err) {
      toast.error((err as Error).message)
      return false
    }
  }

  async function updateUser(id: string, body: Record<string, unknown>) {
    try {
      await apiFetch(`/api/users/${id}`, { method: "PATCH", json: body })
      void mutateTeam()
    } catch (err) {
      toast.error((err as Error).message)
    }
  }

  return (
    <PageShell>
      <PageHeader title="Настройки" description="Фонд, команда и ИИ-ассистент, который оформляет заявки из всех каналов." />
      <div className="space-y-5">
        {data && <AssistantCard settings={data} save={save} />}

        <Card title="Команда" description="Сотрудники, которые разбирают обращения и заявки. Администратор подключает каналы и управляет командой." icon={<IconTile><Users /></IconTile>} delay={60}>
          <div className="mb-4 flex justify-end">
            <Button className="h-10 rounded-full px-4" onClick={() => setInviteOpen(true)}>
              <UserPlus /> Добавить сотрудника
            </Button>
          </div>
          <div className="glass-panel">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Имя</TableHead>
                  <TableHead>Роль</TableHead>
                  <TableHead>Доступ</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {team?.users.map((u) => (
                  <TableRow key={u.id}>
                    <TableCell>
                      <div className="font-medium text-white">{u.name}</div>
                      <div className="text-xs text-muted-foreground">{u.email}</div>
                    </TableCell>
                    <TableCell>
                      <Select value={u.role} onValueChange={(role) => updateUser(u.id, { role })} disabled={u.id === meId}>
                        <SelectTrigger size="sm" className="w-44">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="agent">Сотрудник</SelectItem>
                          <SelectItem value="admin">Администратор</SelectItem>
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>
                      <Switch checked={u.active} disabled={u.id === meId} onCheckedChange={(active) => updateUser(u.id, { active })} aria-label={`Доступ для ${u.name}`} />
                    </TableCell>
                    <TableCell className="text-right">
                      <ResetPassword user={u} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </Card>

        <Card title="Фонд" description="Название видят люди в чате на сайте и в письмах." icon={<IconTile><Building2 /></IconTile>} delay={120}>
          <form
            className="flex flex-wrap items-end gap-3"
            onSubmit={(e) => {
              e.preventDefault()
              void save({ org: { name: orgName } })
            }}
          >
            <div className="min-w-64 flex-1 space-y-1.5">
              <Label htmlFor="org-name">Название фонда</Label>
              <Input id="org-name" value={orgName} onChange={(e) => setOrgName(e.target.value)} />
            </div>
            <Button type="submit" className="rounded-full" disabled={!data || !orgName.trim()}>
              Сохранить
            </Button>
          </form>
        </Card>
      </div>
      <InviteDialog open={inviteOpen} onOpenChange={setInviteOpen} onDone={() => void mutateTeam()} />
    </PageShell>
  )
}

function IconTile({ children }: { children: React.ReactNode }) {
  return <span className="flex size-10 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-[#05c7f2]/20 text-[#7ee3fa] [&_svg]:size-5">{children}</span>
}

type Action = { type: string; text?: string; reason?: string; kind?: string; fields?: Record<string, unknown>; urgent?: boolean; category?: string; priority?: string; summary?: string; subject?: string }

/** Ассистент: модель, ключ, что ему можно, и проверка на примере обращения. */
function AssistantCard({ settings, save }: { settings: Settings; save: (body: Record<string, unknown>, message?: string) => Promise<boolean> }) {
  const ai = settings.ai
  const [provider, setProvider] = useState(ai.provider)
  const preset = presetOf(provider)
  const [baseUrl, setBaseUrl] = useState(ai.baseUrl)
  const [model, setModel] = useState(ai.model)
  const [folderId, setFolderId] = useState(ai.folderId)
  const [key, setKey] = useState("")
  const [signature, setSignature] = useState(ai.signature)
  const [handoffAfter, setHandoffAfter] = useState(String(ai.handoffAfter))
  const [sample, setSample] = useState("Здравствуйте! В Долгопрудном на Новом бульваре сбили собаку, лежит у остановки, задняя лапа не работает. Что делать?")
  const [testing, setTesting] = useState(false)
  const [result, setResult] = useState<{ ms: number; actions: Action[] } | null>(null)
  const ready = provider !== "none" && (key.trim() || settings.aiKeyMask)

  async function saveModel() {
    const ok = await save(
      {
        ai: { provider, baseUrl: baseUrl.trim(), model: model.trim(), folderId: folderId.trim(), signature: signature.trim() || ai.signature, handoffAfter: Number(handoffAfter) || ai.handoffAfter },
        ...(key.trim() ? { aiKey: key.trim() } : {}),
      },
      "Настройки ассистента сохранены",
    )
    if (ok) setKey("")
  }

  async function test() {
    setTesting(true)
    setResult(null)
    try {
      setResult(await apiFetch<{ ms: number; actions: Action[] }>("/api/settings/ai-test", { method: "POST", json: { text: sample } }))
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setTesting(false)
    }
  }

  return (
    <Card
      title="ИИ-ассистент"
      description="Разбирает каждое обращение из всех каналов: понимает, что нужно человеку, ставит тему и срочность и сам оформляет заявку на доске «Заявки» с ответами анкеты. Может отвечать людям — это включается отдельно."
      icon={<IconTile><Sparkles /></IconTile>}
    >
      <div className="space-y-6">
        <div className="grid gap-3 sm:grid-cols-3">
          <Toggle
            title="Ассистент работает"
            hint={ai.enabled ? "Разбирает новые сообщения" : ready ? "Готов — включите" : "Сначала модель и ключ"}
            checked={ai.enabled}
            disabled={!ai.enabled && !(ai.provider !== "none" && settings.aiKeyMask)}
            onChange={(v) => save({ ai: { enabled: v } }, v ? "Ассистент включён" : "Ассистент выключен")}
          />
          <Toggle title="Оформляет заявки" hint="На доске «Заявки» с пометкой «ассистент»" checked={ai.createApplications} onChange={(v) => save({ ai: { createApplications: v } })} />
          <Toggle title="Отвечает людям" hint="Уточняет адрес и фото, зовёт сотрудника" checked={ai.autoReply} onChange={(v) => save({ ai: { autoReply: v } })} />
        </div>

        <div className="space-y-3">
          <Label>Модель</Label>
          <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-5">
            {AI_PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => {
                  setProvider(p.id)
                  setBaseUrl("")
                  setModel("")
                }}
                className={cn("glass-tile p-3 text-left", provider === p.id && "border-[#05c7f2]! bg-[#05c7f2]/15! ring-1 ring-[#05c7f2]/60")}
                aria-pressed={provider === p.id}
              >
                <span className="flex items-center justify-between gap-2 text-sm font-medium text-white">
                  {p.title}
                  {p.fromRussia ? <span className="text-[10px] text-emerald-300">из РФ</span> : <span className="text-[10px] text-amber-300">прокси</span>}
                </span>
                <span className="mt-1 block text-[11px] leading-snug text-white/55">{p.note}</span>
              </button>
            ))}
          </div>
        </div>

        {provider !== "none" && (
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="ai-key" className="flex items-center gap-1.5">
                <KeyRound className="size-3.5" /> Ключ API
              </Label>
              <Input id="ai-key" type="password" autoComplete="off" value={key} onChange={(e) => setKey(e.target.value)} placeholder={settings.aiKeyMask ? `Сохранён ${settings.aiKeyMask} — оставьте пустым` : "Вставьте ключ"} />
              <p className="text-xs text-muted-foreground">Хранится зашифрованным, наружу не показывается.</p>
            </div>
            {preset?.needsFolder ? (
              <div className="space-y-1.5">
                <Label htmlFor="ai-folder">ID каталога Yandex Cloud</Label>
                <Input id="ai-folder" value={folderId} onChange={(e) => setFolderId(e.target.value)} placeholder="b1g…" />
              </div>
            ) : (
              <div />
            )}
            <div className="space-y-1.5">
              <Label htmlFor="ai-url">Адрес API</Label>
              <Input id="ai-url" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder={preset?.baseUrl || "https://…/v1"} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ai-model">Модель</Label>
              <Input id="ai-model" value={model} onChange={(e) => setModel(e.target.value)} placeholder={preset?.model || "имя модели"} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ai-sign">Как ассистент представляется людям</Label>
              <Input id="ai-sign" value={signature} onChange={(e) => setSignature(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ai-handoff">После скольких своих ответов звать сотрудника</Label>
              <Input id="ai-handoff" type="number" min={1} max={50} value={handoffAfter} onChange={(e) => setHandoffAfter(e.target.value)} />
            </div>
            <div className="flex justify-end sm:col-span-2">
              <Button className="rounded-full" onClick={saveModel}>
                Сохранить
              </Button>
            </div>
          </div>
        )}

        <div className="glass-tile space-y-3 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-medium text-white">Проверить на примере</p>
            <Button variant="outline" className="rounded-full" disabled={!ai.provider || ai.provider === "none" || !settings.aiKeyMask || testing} onClick={test}>
              {testing ? <Loader2 className="animate-spin" /> : <Sparkles />} Что сделает ассистент
            </Button>
          </div>
          <Textarea rows={2} value={sample} onChange={(e) => setSample(e.target.value)} />
          <p className="text-xs text-muted-foreground">Ничего не сохраняется и никому не отправляется — только показ, что ассистент поймёт.</p>
          {result && <TestResult result={result} />}
        </div>
      </div>
    </Card>
  )
}

function Toggle({ title, hint, checked, disabled, onChange }: { title: string; hint: string; checked: boolean; disabled?: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className={cn("glass-tile flex items-center justify-between gap-3 p-4", disabled && "opacity-60")}>
      <span>
        <span className="block text-sm font-medium text-white">{title}</span>
        <span className="block text-xs text-white/55">{hint}</span>
      </span>
      <Switch checked={checked} disabled={disabled} onCheckedChange={onChange} />
    </label>
  )
}

function TestResult({ result }: { result: { ms: number; actions: Action[] } }) {
  const classify = result.actions.find((a) => a.type === "classify")
  const app = result.actions.find((a) => a.type === "application")
  const reply = result.actions.find((a) => a.type === "reply")
  const handoff = result.actions.find((a) => a.type === "handoff")
  const kind = app?.kind && isApplicationKind(app.kind) ? APPLICATION_KINDS[app.kind] : null
  return (
    <div className="space-y-3 border-t border-white/10 pt-3 text-sm">
      <p className="text-xs text-white/50">Ответ модели за {(result.ms / 1000).toFixed(1)} с</p>
      {classify && (
        <p>
          <span className="text-white/55">Разбор: </span>
          {classify.subject ?? "—"} · {classify.category ?? "без категории"} · {classify.priority === "urgent" ? <b className="text-rose-200">срочно</b> : (classify.priority ?? "обычно")}
          {classify.summary && <span className="block text-white/70">{classify.summary}</span>}
        </p>
      )}
      {kind && app && (
        <div className="rounded-xl border border-[#05c7f2]/30 bg-[#05c7f2]/10 p-3">
          <p className="font-medium text-white">
            Заявка «{kind.title}»{app.urgent ? " · срочно" : ""}
          </p>
          <ul className="mt-1 space-y-0.5 text-xs text-white/75">
            {kind.fields
              .filter((f) => app.fields?.[f.key] !== undefined && app.fields?.[f.key] !== "")
              .map((f) => (
                <li key={f.key}>
                  {f.label}: {fieldText(app.fields?.[f.key] as never)}
                </li>
              ))}
          </ul>
        </div>
      )}
      {!app && <p className="text-white/60">Заявку не оформит — по сообщению не видно, какая помощь нужна.</p>}
      {reply?.text && (
        <p className="rounded-xl bg-white/[0.07] p-3 whitespace-pre-wrap">
          <span className="block text-xs text-white/50">Ответ человеку</span>
          {reply.text}
        </p>
      )}
      {handoff?.reason && <p className="text-amber-200">Передаст сотруднику: {handoff.reason}</p>}
    </div>
  )
}

function InviteDialog({ open, onOpenChange, onDone }: { open: boolean; onOpenChange: (v: boolean) => void; onDone: () => void }) {
  const [busy, setBusy] = useState(false)
  const [role, setRole] = useState("agent")
  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const f = new FormData(e.currentTarget)
    setBusy(true)
    try {
      await apiFetch("/api/users", { method: "POST", json: { name: f.get("name"), email: f.get("email"), password: f.get("password"), role } })
      toast.success("Сотрудник добавлен — передайте ему почту и пароль")
      onOpenChange(false)
      onDone()
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Новый сотрудник</DialogTitle>
          <DialogDescription>Задайте временный пароль и передайте его лично — сотрудник сможет сменить его позже.</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="u-name">Имя</Label>
            <Input id="u-name" name="name" required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="u-email">Почта</Label>
            <Input id="u-email" name="email" type="email" required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="u-pass">Временный пароль</Label>
            <Input id="u-pass" name="password" type="text" minLength={8} required autoComplete="off" />
          </div>
          <div className="space-y-1.5">
            <Label>Роль</Label>
            <Select value={role} onValueChange={setRole}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="agent">Сотрудник — разбирает обращения и заявки</SelectItem>
                <SelectItem value="admin">Администратор — ещё каналы и команда</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={busy}>
              {busy && <Loader2 className="animate-spin" />}
              Добавить
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function ResetPassword({ user }: { user: TeamUser }) {
  return (
    <Button
      size="sm"
      variant="ghost"
      onClick={async () => {
        const password = prompt(`Новый пароль для ${user.name} (минимум 8 символов)`)
        if (!password) return
        try {
          await apiFetch(`/api/users/${user.id}`, { method: "PATCH", json: { password } })
          toast.success("Пароль изменён, все сеансы сотрудника завершены")
        } catch (err) {
          toast.error((err as Error).message)
        }
      }}
    >
      Сменить пароль
    </Button>
  )
}
