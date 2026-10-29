"use client"

import { ChevronLeft } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { APPLICATION_KIND_ORDER, APPLICATION_KINDS, applicationTitle, isUrgent, type ApplicationKind } from "@/lib/applications/catalog"
import { apiFetch } from "@/lib/client"
import { FieldsEditor, type FieldValues } from "./fields"
import { KindIcon } from "./kind-icon"

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Оформить из обращения во входящих: человек и переписка уже есть. */
  request?: { id: string; contactName: string; category?: string | null } | null
  defaultKind?: ApplicationKind | null
  onCreated?: (app: { id: string; number: number }) => void
}

export function NewApplicationDialog(props: Props) {
  return props.open ? <Body {...props} /> : <Dialog open={false} onOpenChange={props.onOpenChange} />
}

function Body({ open, onOpenChange, request, defaultKind, onCreated }: Props) {
  const [kind, setKind] = useState<ApplicationKind | null>(defaultKind ?? null)
  const [values, setValues] = useState<FieldValues>({})
  const [person, setPerson] = useState({ name: "", phone: "", email: "" })
  const [urgent, setUrgent] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false)

  const autoUrgent = kind ? isUrgent(kind, values) : false
  const urgentValue = urgent ?? autoUrgent

  async function create() {
    if (!kind) return
    if (!request && !person.name.trim()) {
      toast.error("Укажите, кто обратился")
      return
    }
    setBusy(true)
    try {
      const res = await apiFetch<{ id: string; number: number }>("/api/applications", {
        method: "POST",
        json: {
          kind,
          fields: values,
          urgent: urgentValue,
          ...(request ? { requestId: request.id } : { person: { name: person.name, phone: person.phone || undefined, email: person.email || undefined } }),
        },
      })
      toast.success(`Заявка №${res.number} оформлена`)
      onCreated?.(res)
      onOpenChange(false)
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92svh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {kind && (
              <button type="button" onClick={() => setKind(null)} className="-ml-1 rounded-md p-1 text-muted-foreground hover:bg-muted" aria-label="Выбрать другой вид">
                <ChevronLeft className="size-4" />
              </button>
            )}
            {kind ? APPLICATION_KINDS[kind].title : "Новая заявка"}
          </DialogTitle>
          <DialogDescription>
            {request ? `Заявка будет связана с обращением: ${request.contactName}.` : kind ? "Заполните, что знаете — остальное можно дописать позже." : "Что нужно человеку?"}
          </DialogDescription>
        </DialogHeader>

        {!kind ? (
          <div className="grid gap-2 sm:grid-cols-2">
            {APPLICATION_KIND_ORDER.map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setKind(k)}
                className="glass-tile flex items-start gap-3 p-3 text-left"
              >
                <KindIcon kind={k} />
                <span className="space-y-0.5">
                  <span className="block text-sm font-medium">{APPLICATION_KINDS[k].title}</span>
                  <span className="block text-xs leading-snug text-muted-foreground">{APPLICATION_KINDS[k].description}</span>
                </span>
              </button>
            ))}
          </div>
        ) : (
          <div className="space-y-5">
            {!request && (
              <div className="glass-tile grid gap-3 p-3 sm:grid-cols-3">
                <div className="space-y-1.5 sm:col-span-3">
                  <span className="text-xs font-medium text-muted-foreground">Кто обратился</span>
                  <Input autoFocus placeholder="Имя" value={person.name} onChange={(e) => setPerson({ ...person, name: e.target.value })} />
                </div>
                <Input placeholder="Телефон" inputMode="tel" value={person.phone} onChange={(e) => setPerson({ ...person, phone: e.target.value })} className="sm:col-span-1" />
                <Input placeholder="Почта" type="email" value={person.email} onChange={(e) => setPerson({ ...person, email: e.target.value })} className="sm:col-span-2" />
              </div>
            )}
            <FieldsEditor kind={kind} values={values} onChange={setValues} />
            <label className="glass-tile flex items-center justify-between gap-3 p-3 text-sm">
              <span>
                <span className="font-medium">Срочно</span>
                <span className="block text-xs text-muted-foreground">
                  {autoUrgent && urgent === null ? "Отмечено по анкете: животному нужна помощь сейчас" : "Срочные заявки поднимаются наверх и видны на обзоре"}
                </span>
              </span>
              <Switch checked={urgentValue} onCheckedChange={(v) => setUrgent(v)} />
            </label>
            <p className="text-xs text-muted-foreground">Заголовок карточки: «{applicationTitle(kind, values)}»</p>
          </div>
        )}

        {kind && (
          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Отмена
            </Button>
            <Button onClick={create} disabled={busy}>
              {busy ? "Сохраняем…" : "Оформить заявку"}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  )
}
