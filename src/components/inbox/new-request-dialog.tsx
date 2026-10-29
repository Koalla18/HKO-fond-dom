"use client"

import Link from "next/link"
import { useState } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import type { ChannelListItem } from "@/lib/api-types"
import { DEFAULT_CATEGORIES, PRIORITY_LABELS } from "@/lib/channels/catalog"
import { apiFetch } from "@/lib/client"

/** Обращение со звонка или личного визита: сотрудник заносит её сам. */
export function NewRequestDialog({
  open,
  onOpenChange,
  channels,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  channels: ChannelListItem[]
  onCreated: (id: string) => void
}) {
  const manual = channels.filter((c) => c.kind === "manual" && c.enabled)
  const [priority, setPriority] = useState("normal")
  const [category, setCategory] = useState<string>("")
  const [busy, setBusy] = useState(false)

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const f = new FormData(e.currentTarget)
    setBusy(true)
    try {
      const res = await apiFetch<{ id: string }>("/api/requests", {
        method: "POST",
        json: {
          channelId: manual[0]?.id,
          name: f.get("name"),
          phone: String(f.get("phone") ?? "") || undefined,
          email: String(f.get("email") ?? "") || undefined,
          subject: String(f.get("subject") ?? "") || undefined,
          text: f.get("text"),
          priority,
          category: category || undefined,
        },
      })
      toast.success("Обращение заведено")
      onOpenChange(false)
      onCreated(res.id)
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Новое обращение</DialogTitle>
          <DialogDescription>Звонок, личный визит или письмо по почте — занесите обращение, чтобы оно не потерялось.</DialogDescription>
        </DialogHeader>
        {manual.length === 0 ? (
          <div className="space-y-3 text-sm">
            <p>Сначала подключите канал «Телефон и личный приём» — в него попадают обращения, заведённые вручную.</p>
            <Button asChild>
              <Link href="/channels?add=manual">Подключить</Link>
            </Button>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="nr-name">Как зовут</Label>
                <Input id="nr-name" name="name" required />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="nr-phone">Телефон</Label>
                <Input id="nr-phone" name="phone" type="tel" placeholder="+7…" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="nr-email">Почта</Label>
                <Input id="nr-email" name="email" type="email" />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="nr-subject">Тема</Label>
                <Input id="nr-subject" name="subject" placeholder="Кратко, о чём просят" />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="nr-text">Что сказал человек</Label>
                <Textarea id="nr-text" name="text" required rows={5} />
              </div>
              <div className="space-y-1.5">
                <Label>Срочность</Label>
                <Select value={priority} onValueChange={setPriority}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(PRIORITY_LABELS).map(([v, l]) => (
                      <SelectItem key={v} value={v}>
                        {l}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Категория</Label>
                <Select value={category} onValueChange={setCategory}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Не выбрана" />
                  </SelectTrigger>
                  <SelectContent>
                    {DEFAULT_CATEGORIES.map((c) => (
                      <SelectItem key={c} value={c}>
                        {c}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
                Отмена
              </Button>
              <Button type="submit" disabled={busy}>
                {busy ? "Сохраняем…" : "Завести обращение"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
