"use client"

import { Settings2 } from "lucide-react"
import { useRouter, useSearchParams } from "next/navigation"
import { useEffect, useState } from "react"
import { toast } from "sonner"
import useSWR from "swr"
import { ChannelIcon } from "@/components/app/channel-icon"
import { Glass } from "@/components/app/glass"
import { PageHeader, PageShell } from "@/components/app/page-header"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import type { ChannelListItem, MeResponse } from "@/lib/api-types"
import { CHANNEL_ORDER, CHANNELS, isChannelKind, type ChannelKind } from "@/lib/channels/catalog"
import { apiFetch } from "@/lib/client"
import { ago } from "@/lib/format"
import { cn } from "@/lib/utils"
import { ChannelSheet } from "./channel-sheet"

const STATUS: Record<ChannelListItem["status"], { label: string; tone: string }> = {
  ok: { label: "Работает", tone: "bg-emerald-500" },
  connecting: { label: "Подключается", tone: "bg-amber-400 animate-pulse" },
  error: { label: "Ошибка", tone: "bg-destructive" },
  idle: { label: "Выключен", tone: "bg-white/30" },
}

export function ChannelsView() {
  const router = useRouter()
  const params = useSearchParams()
  const { data, mutate } = useSWR<{ channels: ChannelListItem[]; appUrl: string }>("/api/channels")
  const { data: me } = useSWR<MeResponse>("/api/me")
  // ?add=manual — сразу открыть подключение нужного канала (ссылка из входящих).
  const [target, setTarget] = useState<{ kind: ChannelKind; channel?: ChannelListItem } | null>(() => {
    const add = params.get("add")
    return add && isChannelKind(add) ? { kind: add } : null
  })
  const isAdmin = me?.user.role === "admin"
  const channels = data?.channels ?? []

  useEffect(() => {
    if (params.get("add")) router.replace("/channels")
  }, [params, router])

  async function toggle(channel: ChannelListItem, enabled: boolean) {
    try {
      await apiFetch(`/api/channels/${channel.id}`, { method: "PATCH", json: { enabled } })
      void mutate()
    } catch (err) {
      toast.error((err as Error).message)
    }
  }

  return (
    <PageShell>
      <PageHeader
        title="Каналы"
        description="Откуда приходят обращения. Каждый канал складывает сообщения во входящие, а ассистент оформляет из них заявки."
      />
      <div className="space-y-5">
        <Glass className="glass-rise space-y-4 p-6">
          <h2 className="text-[15px] font-semibold">
            Подключены <span className="font-normal text-white/50">· {channels.length}</span>
          </h2>
          {channels.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-white/15 p-6 text-sm text-muted-foreground">Пока ни одного канала. Выберите площадку ниже — начните с почты и ВКонтакте.</p>
          ) : (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {channels.map((c) => {
                const meta = CHANNELS[c.kind as ChannelKind]
                const status = c.enabled ? STATUS[c.status] : STATUS.idle
                return (
                  <article key={c.id} className="glass-tile flex flex-col gap-3 p-4">
                    <div className="flex items-start gap-3">
                      <ChannelIcon kind={c.kind} size="lg" />
                      <div className="min-w-0 flex-1">
                        <h3 className="truncate font-semibold">{c.name}</h3>
                        <p className="text-xs text-muted-foreground">{meta?.title}</p>
                      </div>
                      {isAdmin && <Switch checked={c.enabled} onCheckedChange={(v) => toggle(c, v)} aria-label={`Включить ${c.name}`} />}
                    </div>
                    <div className="space-y-1 text-xs">
                      <p className="flex items-center gap-1.5 font-medium">
                        <span className={cn("size-2 rounded-full", status.tone)} />
                        {status.label}
                      </p>
                      {c.enabled && c.statusMessage && (
                        <p className={cn("line-clamp-2", c.status === "error" ? "text-destructive" : "text-muted-foreground")}>{c.statusMessage}</p>
                      )}
                      <p className="text-muted-foreground">{c.lastActivityAt ? `Последнее сообщение ${ago(c.lastActivityAt)}` : "Сообщений ещё не было"}</p>
                    </div>
                    {isAdmin && (
                      <Button variant="outline" size="sm" className="mt-auto self-start" onClick={() => setTarget({ kind: c.kind as ChannelKind, channel: c })}>
                        <Settings2 /> Настроить
                      </Button>
                    )}
                  </article>
                )
              })}
            </div>
          )}
        </Glass>

        <Glass className="glass-rise space-y-4 p-6" style={{ animationDelay: "80ms" }}>
          <h2 className="text-[15px] font-semibold">Добавить источник</h2>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {CHANNEL_ORDER.map((kind) => {
              const meta = CHANNELS[kind]
              const count = channels.filter((c) => c.kind === kind).length
              return (
                <article key={kind} className="glass-tile flex flex-col gap-3 p-4">
                  <div className="flex items-center gap-3">
                    <ChannelIcon kind={kind} size="md" />
                    <h3 className="font-semibold">{meta.title}</h3>
                    {count > 0 && <Badge variant="secondary" className="ml-auto">подключено: {count}</Badge>}
                  </div>
                  <p className="text-sm text-muted-foreground">{meta.description}</p>
                  <div className="mt-auto flex items-center justify-between gap-2">
                    <span className="text-xs text-muted-foreground">
                      {meta.needsHttps ? "Нужен HTTPS-домен" : meta.transport === "none" ? "Без внешних ключей" : "Работает по IP"}
                    </span>
                    <Button size="sm" variant={count ? "outline" : "default"} disabled={!isAdmin} onClick={() => setTarget({ kind })}>
                      {count ? "Ещё один" : "Подключить"}
                    </Button>
                  </div>
                </article>
              )
            })}
          </div>
          {!isAdmin && me && <p className="text-xs text-muted-foreground">Подключать каналы может администратор.</p>}
        </Glass>
      </div>
      <ChannelSheet
        target={target}
        appUrl={data?.appUrl ?? ""}
        emailChannels={channels.filter((c) => c.kind === "email")}
        isAdmin={isAdmin}
        onClose={() => {
          setTarget(null)
          void mutate()
        }}
        onSaved={(channel) => {
          void mutate()
          setTarget({ kind: channel.kind as ChannelKind, channel })
        }}
      />
    </PageShell>
  )
}
