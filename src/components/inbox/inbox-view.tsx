"use client"

import { Inbox as InboxIcon } from "lucide-react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { useCallback, useEffect, useState } from "react"
import useSWR from "swr"
import { SidebarTrigger } from "@/components/ui/sidebar"
import type { ChannelListItem, RequestDetail, RequestListResponse } from "@/lib/api-types"
import { cn } from "@/lib/utils"
import { Details } from "./details"
import { NewRequestDialog } from "./new-request-dialog"
import { RequestList } from "./request-list"
import { Thread } from "./thread"

export function InboxView() {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const view = params.get("view") ?? "active"
  const channel = params.get("channel")
  const selectedId = params.get("id")
  const [query, setQuery] = useState(params.get("q") ?? "")
  const [debounced, setDebounced] = useState(query)
  const [newOpen, setNewOpen] = useState(false)

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query.trim()), 250)
    return () => clearTimeout(timer)
  }, [query])

  const listKey = `/api/requests?${new URLSearchParams({
    view: debounced ? "all" : view,
    ...(channel ? { channel } : {}),
    ...(debounced ? { q: debounced } : {}),
  })}`
  const { data: list, mutate: mutateList } = useSWR<RequestListResponse>(listKey)
  const { data: detail, mutate: mutateDetail, error: detailError } = useSWR<RequestDetail>(selectedId ? `/api/requests/${selectedId}` : null)
  const { data: channels } = useSWR<{ channels: ChannelListItem[] }>("/api/channels")
  const channelName = channel ? channels?.channels.find((c) => c.id === channel)?.name ?? null : null

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

  const refresh = useCallback(() => {
    void mutateDetail()
    void mutateList()
  }, [mutateDetail, mutateList])

  return (
    <div className={cn("grid h-full min-h-0 grid-cols-1 gap-3 p-3 sm:p-4 lg:grid-cols-[360px_minmax(0,1fr)]", detail && "xl:grid-cols-[380px_minmax(0,1fr)_330px]", !detail && "xl:grid-cols-[380px_minmax(0,1fr)]")}>
      <div className={cn("glass-panel relative min-h-0", selectedId && "hidden lg:block")}>
        <SidebarTrigger className="absolute top-4 right-28 lg:hidden" />
        <RequestList
          data={list}
          view={debounced ? "all" : view}
          channelName={channelName}
          selectedId={selectedId}
          query={query}
          onQuery={setQuery}
          hrefFor={hrefFor}
          onNew={() => setNewOpen(true)}
        />
      </div>
      <div className={cn("glass-panel min-h-0", !selectedId && "hidden lg:block")}>
        {detail ? (
          <Thread detail={detail} backHref={hrefFor({ id: null })} onChanged={refresh} />
        ) : (
          <div className="grid h-full place-items-center p-8 text-center">
            <div className="max-w-xs space-y-3">
              <div className="mx-auto grid size-14 place-items-center rounded-2xl bg-white/10 text-primary">
                <InboxIcon className="size-6" />
              </div>
              <p className="font-medium">{selectedId && detailError ? "Обращение не найдено" : selectedId ? "Открываем обращение…" : "Выберите обращение слева"}</p>
              <p className="text-sm text-muted-foreground">
                Все обращения — из почты, соцсетей, мессенджеров и с сайта — собираются здесь. Значок у аватара показывает, откуда пришло сообщение.
              </p>
            </div>
          </div>
        )}
      </div>
      {detail && <div className="glass-panel hidden min-h-0 xl:block"><Details detail={detail} onChanged={refresh} hrefFor={hrefFor} /></div>}
      <NewRequestDialog
        open={newOpen}
        onOpenChange={setNewOpen}
        channels={channels?.channels ?? []}
        onCreated={(id) => {
          void mutateList()
          router.push(hrefFor({ id }))
        }}
      />
    </div>
  )
}
