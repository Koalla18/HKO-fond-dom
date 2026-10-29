"use client"

import { useRouter, useSearchParams } from "next/navigation"
import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { apiFetch } from "@/lib/client"

// Поля прямо на фото: полупрозрачные, без карточки вокруг формы.
const field = "h-11 rounded-[10px] border-white/20 bg-white/10 text-white placeholder:text-white/40 focus-visible:border-white/60 focus-visible:ring-white/20"

/** Куда вернуть после входа: только страницы этого кабинета («/\\evil.com» браузер считает чужим сайтом). */
function safeNext(next: string | null) {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.includes("\\")) return "/inbox"
  try {
    const url = new URL(next, window.location.origin)
    return url.origin === window.location.origin ? url.pathname + url.search + url.hash : "/inbox"
  } catch {
    return "/inbox"
  }
}

export function LoginForm() {
  const router = useRouter()
  const params = useSearchParams()
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    setPending(true)
    setError(null)
    try {
      await apiFetch("/api/auth/login", { method: "POST", json: { email: form.get("email"), password: form.get("password") } })
      router.replace(safeNext(params.get("next")))
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось войти")
      setPending(false)
    }
  }

  return (
    <form method="post" onSubmit={onSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="email" className="text-white/85">
          Почта
        </Label>
        <Input id="email" name="email" type="email" autoComplete="username" required autoFocus className={field} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="password" className="text-white/85">
          Пароль
        </Label>
        <Input id="password" name="password" type="password" autoComplete="current-password" required className={field} />
      </div>
      {error && (
        <p role="alert" className="rounded-lg bg-red-500/20 px-3 py-2 text-sm text-red-100">
          {error}
        </p>
      )}
      <Button type="submit" className="mt-2 h-11 w-full rounded-[10px] bg-white text-base font-semibold text-[#0a0d14] hover:bg-white/90" disabled={pending}>
        {pending ? "Входим…" : "Войти"}
      </Button>
    </form>
  )
}
