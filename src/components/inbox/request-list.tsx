"use client"

import { Bot, Plus, Search } from "lucide-react"
import Link from "next/link"
import { ChannelIcon } from "@/components/app/channel-icon"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import type { RequestListItem, RequestListResponse } from "@/lib/api-types"
import { CHANNELS, type ChannelKind } from "@/lib/channels/catalog"
import { initials, shortTime } from "@/lib/format"
import { cn } from "@/lib/utils"
import { StatusDot } from "./status"

export const VIEWS = [
  { id: "active", label: "Активные", count: "active" },
  { id: "mine", label: "Мои", count: "mine" },
  { id: "unassigned", label: "Без ответственного", count: "unassigned" },
  { id: "ai", label: "Ведёт ассистент", count: "ai" },
  { id: "resolved", label: "Решённые" },
  { id: "spam", label: "Спам" },
] as const

export function RequestList({
  data,
  view,
  channelName,
  selectedId,
  query,
  onQuery,
  hrefFor,
  onNew,
}: {
  data: RequestListResponse | undefined
  view: string
  channelName: string | null
  selectedId: string | null
  query: string
  onQuery: (q: string) => void
  hrefFor: (patch: Record<string, string | null>) => string
  onNew: () => void
}) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="space-y-3 border-b border-white/10 px-4 pt-4 pb-3">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <h1 className="truncate text-xl font-semibold tracking-tight text-white">{channelName ?? "Входящие"}</h1>
            <p className="text-xs text-muted-foreground">
              {data ? `${data.counts.fresh} новых · ${data.counts.unread} непрочитанных сообщений` : "Загружаем…"}
            </p>
          </div>
          <Button size="sm" variant="outline" onClick={onNew}>
            <Plus />
            Обращение
          </Button>
        </div>
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            placeholder="Имя, почта, телефон, текст, №"
            className="h-9 pl-8"
            aria-label="Поиск по обращениям"
          />
        </div>
        <nav className="-mx-1 flex gap-1 overflow-x-auto pb-0.5 scroll-thin" aria-label="Фильтр заявок">
          {VIEWS.map((v) => {
            const count = "count" in v && data ? data.counts[v.count] : null
            const active = view === v.id
            return (
              <Link prefetch={false}
                key={v.id}
                href={hrefFor({ view: v.id === "active" ? null : v.id, id: null })}
                className={cn(
                  "flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                  active ? "border-white/0 bg-white text-[#0c143b]" : "border-white/10 text-white/70 hover:bg-white/10 hover:text-white",
                )}
              >
                {v.label}
                {count ? <span className={cn("tabular-nums", active ? "text-[#0c143b]/60" : "text-white/50")}>{count}</span> : null}
              </Link>
            )
          })}
        </nav>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto scroll-thin">
        {!data && <ListSkeleton />}
        {data && data.items.length === 0 && (
          <div className="px-6 py-16 text-center text-sm text-muted-foreground">
            {query ? "Ничего не нашлось" : view === "active" ? "Все обращения разобраны — новых нет" : "Здесь пусто"}
          </div>
        )}
        <ul>
          {data?.items.map((item) => (
            <li key={item.id}>
              <RequestRow item={item} selected={item.id === selectedId} href={hrefFor({ id: item.id })} />
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

function RequestRow({ item, selected, href }: { item: RequestListItem; selected: boolean; href: string }) {
  const unread = item.unread > 0
  const meta = CHANNELS[item.channel.kind as ChannelKind]
  return (
    <Link prefetch={false}
      href={href}
      scroll={false}
      className={cn(
        "relative mx-2 my-1 flex gap-3 rounded-2xl px-3 py-3 transition-colors",
        selected ? "bg-white/[0.14] shadow-[inset_0_1px_0_rgba(255,255,255,.12)]" : "hover:bg-white/[0.07]",
        item.priority === "urgent" && "before:absolute before:inset-y-3 before:left-0 before:w-[3px] before:rounded-full before:bg-rose-400",
      )}
      aria-current={selected ? "true" : undefined}
    >
      <div className="relative shrink-0">
        <Avatar className="size-10">
          {item.contact.avatarUrl && <AvatarImage src={item.contact.avatarUrl} alt="" />}
          <AvatarFallback className="bg-secondary text-sm text-secondary-foreground">{initials(item.contact.name)}</AvatarFallback>
        </Avatar>
        <ChannelIcon kind={item.channel.kind} size="xs" className="absolute -right-1 -bottom-1 ring-2 ring-[#18203a]" />
      </div>
      <div className="min-w-0 flex-1 space-y-0.5">
        <div className="flex items-baseline gap-2">
          <span className={cn("min-w-0 flex-1 truncate text-sm", unread ? "font-semibold" : "font-medium")}>{item.contact.name}</span>
          <time className={cn("shrink-0 text-xs tabular-nums", unread ? "font-medium text-primary" : "text-muted-foreground")}>
            {shortTime(item.lastMessageAt)}
          </time>
        </div>
        {item.subject && <p className="truncate text-xs font-medium text-foreground/80">{item.subject}</p>}
        <p className={cn("line-clamp-2 text-xs leading-snug", unread ? "text-foreground" : "text-muted-foreground")}>
          {item.lastMessageDirection === "out" && <span className="text-muted-foreground">Вы: </span>}
          {item.lastMessagePreview || "—"}
        </p>
        <div className="flex items-center gap-2 pt-1 text-[11px] text-muted-foreground">
          <StatusDot status={item.status} />
          <span className="truncate">
            #{item.number} · {meta?.short ?? item.channel.kind}
            {item.category ? ` · ${item.category}` : ""}
          </span>
          {item.aiHandling && <Bot className="size-3.5 shrink-0 text-primary" aria-label="Ведёт ассистент" />}
          {item.assignee?.name && <span className="ml-auto max-w-24 shrink-0 truncate">{item.assignee.name}</span>}
          {unread && (
            <span className="ml-auto grid h-4 min-w-4 shrink-0 place-items-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground">
              {item.unread}
            </span>
          )}
        </div>
      </div>
    </Link>
  )
}

function ListSkeleton() {
  return (
    <div className="space-y-px">
      {Array.from({ length: 7 }).map((_, i) => (
        <div key={i} className="flex gap-3 px-5 py-3">
          <Skeleton className="size-10 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3.5 w-2/3" />
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-1/3" />
          </div>
        </div>
      ))}
    </div>
  )
}
