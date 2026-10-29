"use client"

import { Search } from "lucide-react"
import Link from "next/link"
import { useEffect, useState } from "react"
import useSWR from "swr"
import { ChannelIcon } from "@/components/app/channel-icon"
import { PageHeader, PageShell } from "@/components/app/page-header"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Input } from "@/components/ui/input"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { initials, shortTime } from "@/lib/format"

type Row = { id: string; name: string; email: string | null; phone: string | null; requests: number; applications: number; lastRequestId: string | null; lastAt: string | null; kinds: string[] }

export function ContactsView() {
  const [q, setQ] = useState("")
  const [debounced, setDebounced] = useState("")
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 250)
    return () => clearTimeout(t)
  }, [q])
  const { data } = useSWR<{ contacts: Row[] }>(`/api/contacts${debounced ? `?q=${encodeURIComponent(debounced)}` : ""}`)

  return (
    <PageShell>
      <PageHeader
        title="Люди"
        description="Все, кто обращался в фонд. Если человек писал из разных каналов и оставил одну почту или телефон — его история собирается в одну карточку."
      />
      <div className="space-y-4">
        <div className="relative max-w-sm">
          <Search className="pointer-events-none absolute top-1/2 left-3.5 z-10 size-4 -translate-y-1/2 text-white/60" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Имя, почта или телефон"
            className="glass-chip h-10 rounded-full border-white/15 pl-10 placeholder:text-white/45"
            aria-label="Поиск людей"
          />
        </div>
        <div className="glass-panel">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Человек</TableHead>
                <TableHead>Связь</TableHead>
                <TableHead>Каналы</TableHead>
                <TableHead className="text-right">Обращений</TableHead>
                <TableHead className="text-right">Заявок</TableHead>
                <TableHead className="text-right">Последнее</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data?.contacts.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">
                    {debounced ? "Никого не нашли" : "Обращений пока не было"}
                  </TableCell>
                </TableRow>
              )}
              {data?.contacts.map((c) => (
                <TableRow key={c.id}>
                  <TableCell>
                    <Link href={c.lastRequestId ? `/inbox?id=${c.lastRequestId}&view=all` : "#"} className="flex items-center gap-2.5 font-medium text-white hover:text-[#7ee3fa]">
                      <Avatar className="size-8">
                        <AvatarFallback className="bg-white/12 text-xs text-white">{initials(c.name)}</AvatarFallback>
                      </Avatar>
                      {c.name}
                    </Link>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    <div>{c.phone}</div>
                    <div>{c.email}</div>
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      {c.kinds.map((k) => (
                        <ChannelIcon key={k} kind={k} size="sm" />
                      ))}
                    </div>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{c.requests}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {c.applications ? (
                      <Link href={`/applications?view=list&state=all&q=${encodeURIComponent(c.name)}`} className="rounded-full bg-white/10 px-2 py-0.5 hover:bg-white/20">
                        {c.applications}
                      </Link>
                    ) : (
                      <span className="text-white/35">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right text-sm text-muted-foreground">{c.lastAt ? shortTime(c.lastAt) : "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>
    </PageShell>
  )
}
