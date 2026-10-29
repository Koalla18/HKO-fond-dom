"use client"

import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { APPLICATION_KINDS, fieldText, type ApplicationFieldValue, type ApplicationKind } from "@/lib/applications/catalog"
import { cn } from "@/lib/utils"

export type FieldValues = Record<string, ApplicationFieldValue>

function Pill({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "rounded-full border px-2.5 py-1 text-xs transition-colors",
        active ? "border-white bg-white text-[#0c143b]" : "border-white/15 bg-white/[0.05] text-white/85 hover:bg-white/[0.12]",
      )}
    >
      {children}
    </button>
  )
}

/** Анкета для сотрудника: те же поля, что у публичной формы, но без обязательности — можно завести черновик. */
export function FieldsEditor({ kind, values, onChange }: { kind: ApplicationKind; values: FieldValues; onChange: (next: FieldValues) => void }) {
  const set = (key: string, value: ApplicationFieldValue | undefined) => {
    const next = { ...values }
    if (value === undefined || value === "" || (Array.isArray(value) && !value.length)) delete next[key]
    else next[key] = value
    onChange(next)
  }
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {APPLICATION_KINDS[kind].fields.map((def) => {
        const value = values[def.key]
        const wide = def.wide || def.type === "chips" || def.type === "textarea" || (def.options?.length ?? 0) > 3
        if (def.type === "boolean") {
          return (
            <label key={def.key} className={cn("flex items-start gap-2.5 text-sm", wide && "sm:col-span-2")}>
              <input type="checkbox" className="mt-0.5 size-4 accent-[var(--primary)]" checked={value === true} onChange={(e) => set(def.key, e.target.checked)} />
              {def.label}
            </label>
          )
        }
        return (
          <div key={def.key} className={cn("space-y-1.5", wide && "sm:col-span-2")}>
            <span className="text-xs font-medium text-muted-foreground">{def.label}</span>
            {def.type === "text" && <Input value={String(value ?? "")} placeholder={def.placeholder} onChange={(e) => set(def.key, e.target.value)} />}
            {def.type === "textarea" && <Textarea rows={3} value={String(value ?? "")} placeholder={def.placeholder} onChange={(e) => set(def.key, e.target.value)} />}
            {def.type === "select" && (
              <div className="flex flex-wrap gap-1.5">
                {def.options?.map((o) => (
                  <Pill key={o} active={value === o} onClick={() => set(def.key, value === o ? undefined : o)}>
                    {o}
                  </Pill>
                ))}
              </div>
            )}
            {def.type === "chips" && (
              <div className="flex flex-wrap gap-1.5">
                {def.options?.map((o) => {
                  const list = Array.isArray(value) ? value : []
                  return (
                    <Pill key={o} active={list.includes(o)} onClick={() => set(def.key, list.includes(o) ? list.filter((x) => x !== o) : [...list, o])}>
                      {o}
                    </Pill>
                  )
                })}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

/** Ответы анкеты для чтения. Ссылки (анкета животного) кликабельны. */
export function FieldsView({ kind, values }: { kind: ApplicationKind; values: FieldValues }) {
  const rows = APPLICATION_KINDS[kind].fields.map((def) => ({ def, text: fieldText(values[def.key]) })).filter((r) => r.text)
  if (!rows.length) return <p className="text-sm text-muted-foreground">Анкета пока пустая — заполните, что известно.</p>
  return (
    <dl className="grid gap-x-4 gap-y-3 sm:grid-cols-2">
      {rows.map(({ def, text }) => (
        <div key={def.key} className={cn("space-y-0.5", (def.wide || def.type === "textarea" || text.length > 40) && "sm:col-span-2")}>
          <dt className="text-xs text-muted-foreground">{def.label}</dt>
          <dd className="text-sm break-words whitespace-pre-wrap">
            {/^https?:\/\//.test(text) ? (
              <a href={text} target="_blank" rel="noreferrer" className="text-primary underline underline-offset-2">
                {text.replace(/^https?:\/\//, "")}
              </a>
            ) : (
              text
            )}
          </dd>
        </div>
      ))}
    </dl>
  )
}
