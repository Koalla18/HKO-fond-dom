"use client"

import { Check, Copy, FlaskConical, Loader2, PlugZap, Trash2 } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"
import { ChannelIcon } from "@/components/app/channel-icon"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import type { ChannelListItem } from "@/lib/api-types"
import { CHANNELS, type ChannelKind, type FieldDef } from "@/lib/channels/catalog"
import { apiFetch } from "@/lib/client"

type Target = { kind: ChannelKind; channel?: ChannelListItem }

function CopyBox({ label, value, multiline }: { label: string; value: string; multiline?: boolean }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <div className="flex items-start gap-2">
        {multiline ? (
          <Textarea readOnly value={value} className="min-h-24 font-mono text-xs" onFocus={(e) => e.currentTarget.select()} />
        ) : (
          <Input readOnly value={value} className="font-mono text-xs" onFocus={(e) => e.currentTarget.select()} />
        )}
        <Button
          type="button"
          variant="outline"
          size="icon"
          onClick={async () => {
            await navigator.clipboard.writeText(value)
            setCopied(true)
            setTimeout(() => setCopied(false), 1500)
          }}
          aria-label={`Скопировать: ${label}`}
        >
          {copied ? <Check /> : <Copy />}
        </Button>
      </div>
    </div>
  )
}

function FieldInput({ field, value, masked, onChange, emailChannels }: {
  field: FieldDef
  value: unknown
  masked?: string | null
  onChange: (v: unknown) => void
  emailChannels: ChannelListItem[]
}) {
  const id = `f-${field.key}`
  if (field.type === "boolean") {
    return (
      <div className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2">
        <Label htmlFor={id} className="font-normal">
          {field.label}
        </Label>
        <Switch id={id} checked={value === true || value === "true"} onCheckedChange={onChange} />
      </div>
    )
  }
  const options = field.key === "replyChannelId" ? emailChannels.map((c) => ({ value: c.id, label: `${c.name} (${String(c.config.address ?? "")})` })) : field.options
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>
        {field.label}
        {field.required && <span className="text-destructive"> *</span>}
      </Label>
      {options ? (
        <Select value={value ? String(value) : undefined} onValueChange={onChange}>
          <SelectTrigger id={id} className="w-full">
            <SelectValue placeholder={field.key === "replyChannelId" && !options.length ? "Сначала подключите почтовый ящик" : "Выберите"} />
          </SelectTrigger>
          <SelectContent>
            {options.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : field.type === "textarea" ? (
        <Textarea id={id} value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} placeholder={field.placeholder} />
      ) : (
        <Input
          id={id}
          type={field.secret ? "password" : field.type === "number" ? "number" : "text"}
          autoComplete={field.secret ? "new-password" : "off"}
          value={String(value ?? "")}
          onChange={(e) => onChange(field.type === "number" ? e.target.value.replace(/\D/g, "") : e.target.value)}
          placeholder={field.secret && masked ? `Сохранено: ${masked} — оставьте пустым, чтобы не менять` : field.placeholder}
        />
      )}
      {field.help && <p className="text-xs text-muted-foreground">{field.help}</p>}
    </div>
  )
}

type SheetProps = {
  onClose: () => void
  onSaved: (channel: ChannelListItem) => void
  appUrl: string
  emailChannels: ChannelListItem[]
  isAdmin: boolean
}

export function ChannelSheet({ target, ...props }: SheetProps & { target: Target | null }) {
  if (!target) return null
  // key: при переходе к другому каналу (или после сохранения нового) форма собирается заново.
  return <ChannelSheetBody key={`${target.kind}:${target.channel?.id ?? "new"}`} target={target} {...props} />
}

function initialValues(target: Target) {
  const values: Record<string, unknown> = {}
  for (const f of CHANNELS[target.kind].fields) {
    values[f.key] = f.secret ? "" : (target.channel?.config[f.key] ?? f.default ?? "")
  }
  return values
}

function ChannelSheetBody({ target, onClose, onSaved, appUrl, emailChannels, isAdmin }: SheetProps & { target: Target }) {
  const meta = CHANNELS[target.kind]
  const channel = target.channel
  const [name, setName] = useState(() => channel?.name ?? defaultName(target.kind))
  const [values, setValues] = useState<Record<string, unknown>>(() => initialValues(target))
  const [enabled, setEnabled] = useState(() => channel?.enabled ?? true)
  const [busy, setBusy] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null)
  const [simText, setSimText] = useState("")

  const webhookUrl = channel ? `${appUrl}/api/webhooks/${channel.id}` : null
  const origin = appUrl || (typeof window !== "undefined" ? window.location.origin : "")

  async function save() {
    const missing = meta.fields.find((f) => f.required && !f.secret && !String(values[f.key] ?? "").trim())
    const missingSecret = meta.fields.find((f) => f.required && f.secret && !String(values[f.key] ?? "").trim() && !channel?.secretsMasked[f.key])
    if (enabled && (missing || missingSecret)) {
      toast.error(`Заполните поле «${(missing ?? missingSecret)!.label}» или выключите канал`)
      return
    }
    const config = Object.fromEntries(meta.fields.filter((f) => !f.secret).map((f) => [f.key, values[f.key]]))
    const secrets = Object.fromEntries(meta.fields.filter((f) => f.secret).map((f) => [f.key, values[f.key]]))
    setBusy(true)
    try {
      const res = channel
        ? await apiFetch<{ channel: ChannelListItem }>(`/api/channels/${channel.id}`, { method: "PATCH", json: { name, enabled, config, secrets } })
        : await apiFetch<{ channel: ChannelListItem }>("/api/channels", { method: "POST", json: { kind: target.kind, name, enabled, config, secrets } })
      toast.success(channel ? "Канал сохранён" : "Канал подключён")
      onSaved(res.channel)
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function test() {
    if (!channel) return
    setTesting(true)
    setTestResult(null)
    try {
      setTestResult(await apiFetch<{ ok: boolean; message: string }>(`/api/channels/${channel.id}/test`, { method: "POST" }))
    } catch (err) {
      setTestResult({ ok: false, message: (err as Error).message })
    } finally {
      setTesting(false)
    }
  }

  async function simulate() {
    if (!channel || !simText.trim()) return
    try {
      await apiFetch("/api/dev/simulate", {
        method: "POST",
        json: { channelId: channel.id, externalUserId: "demo", name: "Тестовый посетитель", text: simText },
      })
      toast.success("Тестовое обращение во входящих")
      setSimText("")
    } catch (err) {
      toast.error((err as Error).message)
    }
  }

  async function remove() {
    if (!channel || !confirm(`Удалить канал «${channel.name}»?`)) return
    try {
      await apiFetch(`/api/channels/${channel.id}`, { method: "DELETE" })
      toast.success("Канал удалён")
      onClose()
    } catch (err) {
      toast.error((err as Error).message)
    }
  }

  const httpsMissing = meta.needsHttps && !appUrl.startsWith("https://")

  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full gap-0 overflow-y-auto p-0 sm:max-w-xl data-[side=right]:sm:top-3 data-[side=right]:sm:right-3 data-[side=right]:sm:h-[calc(100%-1.5rem)] data-[side=right]:sm:rounded-[26px] data-[side=right]:sm:border">
        <SheetHeader className="border-b p-5">
          <div className="flex items-center gap-3">
            <ChannelIcon kind={target.kind} size="lg" />
            <div>
              <SheetTitle>{channel ? channel.name : `Подключить: ${meta.title}`}</SheetTitle>
              <SheetDescription>{meta.description}</SheetDescription>
            </div>
          </div>
        </SheetHeader>

        <div className="space-y-6 p-5">
          {httpsMissing && (
            <Alert>
              <AlertDescription>
                Этой площадке нужен публичный HTTPS-адрес платформы для вебхуков. Сейчас адрес {appUrl || "не задан"} — канал можно настроить заранее,
                заработает он после подключения домена с сертификатом.
              </AlertDescription>
            </Alert>
          )}

          <section className="space-y-2">
            <h3 className="text-sm font-semibold">Как подключить</h3>
            <ol className="space-y-2 text-sm text-muted-foreground">
              {meta.steps.map((step, i) => (
                <li key={i} className="flex gap-2.5">
                  <span className="grid size-5 shrink-0 place-items-center rounded-full bg-accent text-[11px] font-semibold text-accent-foreground">{i + 1}</span>
                  <span>{step}</span>
                </li>
              ))}
            </ol>
            {meta.note && <p className="rounded-xl bg-white/[0.07] px-3 py-2 text-xs text-muted-foreground">{meta.note}</p>}
          </section>

          {["instagram", "facebook", "whatsapp"].includes(target.kind) && (
            <section className="space-y-3 rounded-xl border p-4">
              <h3 className="text-sm font-semibold">Данные для кабинета Meta</h3>
              {webhookUrl ? (
                <>
                  <CopyBox label="Адрес вебхука (Callback URL)" value={webhookUrl} />
                  <CopyBox label="Токен проверки (Verify token)" value={String(channel?.config.verifyToken ?? "")} />
                </>
              ) : (
                <p className="text-xs text-muted-foreground">Сохраните канал — здесь появятся адрес вебхука и токен проверки.</p>
              )}
            </section>
          )}

          <section className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="ch-name">Название в платформе</Label>
              <Input id="ch-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Например: Почта help@" />
            </div>
            {meta.fields.map((field) => (
              <FieldInput
                key={field.key}
                field={field}
                value={values[field.key]}
                masked={channel?.secretsMasked[field.key]}
                onChange={(v) => setValues((prev) => ({ ...prev, [field.key]: v }))}
                emailChannels={emailChannels}
              />
            ))}
            <div className="glass-tile flex items-center justify-between gap-3 px-3 py-2.5">
              <div>
                <Label htmlFor="ch-enabled">Канал включён</Label>
                <p className="text-xs text-muted-foreground">Выключенный канал не принимает новые сообщения, история сохраняется.</p>
              </div>
              <Switch id="ch-enabled" checked={enabled} onCheckedChange={setEnabled} />
            </div>
          </section>

          {channel && target.kind === "widget" && (
            <section className="space-y-2">
              <CopyBox label="Код для сайта — вставьте перед </body>" value={`<script src="${origin}/widget.js" data-channel="${channel.id}" async></script>`} multiline />
            </section>
          )}
          {channel && target.kind === "webform" && (
            <section className="space-y-3">
              <CopyBox label="Адрес приёма заявок (POST)" value={`${origin}/api/public/form/${channel.id}`} />
              <CopyBox label="Готовая форма для сайта" value={formSnippet(origin, channel.id)} multiline />
            </section>
          )}

          {channel && (
            <section className="space-y-3 rounded-xl border p-4">
              <h3 className="text-sm font-semibold">Проверка</h3>
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" size="sm" onClick={test} disabled={testing}>
                  {testing ? <Loader2 className="animate-spin" /> : <PlugZap />}
                  Проверить подключение
                </Button>
              </div>
              {testResult && (
                <p className={testResult.ok ? "text-sm text-emerald-700" : "text-sm text-destructive"} role="status">
                  {testResult.ok ? "✓ " : "✗ "}
                  {testResult.message}
                </p>
              )}
              {isAdmin && (
                <div className="space-y-2 border-t pt-3">
                  <Label htmlFor="sim" className="flex items-center gap-1.5">
                    <FlaskConical className="size-4" /> Тестовое обращение
                  </Label>
                  <p className="text-xs text-muted-foreground">Покажет, как сообщение из этого канала выглядит во входящих. В саму площадку ничего не уходит.</p>
                  <div className="flex gap-2">
                    <Input id="sim" value={simText} onChange={(e) => setSimText(e.target.value)} placeholder="Здравствуйте, нужна помощь…" />
                    <Button type="button" variant="secondary" onClick={simulate} disabled={!simText.trim()}>
                      Отправить
                    </Button>
                  </div>
                </div>
              )}
            </section>
          )}
        </div>

        <SheetFooter className="sticky bottom-0 flex-row items-center border-t border-white/10 bg-[#0e1530]/70 p-4 backdrop-blur-xl">
          {channel && (
            <Button type="button" variant="ghost" size="sm" className="mr-auto text-destructive" onClick={remove}>
              <Trash2 /> Удалить
            </Button>
          )}
          <Button type="button" variant="ghost" onClick={onClose}>
            Закрыть
          </Button>
          <Button type="button" onClick={save} disabled={busy}>
            {busy ? <Loader2 className="animate-spin" /> : null}
            {channel ? "Сохранить" : "Подключить"}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}

function defaultName(kind: ChannelKind): string {
  return { email: "Почта фонда", vk: "Сообщество ВКонтакте", telegram: "Бот в Telegram", max: "Бот в MAX", ok: "Группа в Одноклассниках", instagram: "Instagram фонда", facebook: "Страница Facebook", whatsapp: "WhatsApp фонда", webform: "Форма на сайте", widget: "Чат на сайте", manual: "Телефон и приём" }[kind]
}

function formSnippet(origin: string, id: string) {
  return `<!-- Поля как в форме «Обратная связь» на fundhome.ru -->
<form action="${origin}/api/public/form/${id}" method="post">
  <input name="form[name]" placeholder="Введите имя" required>
  <input name="form[phone]" placeholder="Введите номер телефона">
  <input name="form[email]" type="email" placeholder="Введите e-mail">
  <input name="form[theme]" placeholder="Укажите тему">
  <textarea name="form[text]" placeholder="Ваше сообщение, кому оно адресовано" required></textarea>
  <input name="website" style="display:none" tabindex="-1" autocomplete="off">
  <input type="hidden" name="redirect" value="https://fundhome.ru/">
  <button type="submit">Отправить</button>
</form>`
}
