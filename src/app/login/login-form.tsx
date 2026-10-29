"use client"

import { useRouter, useSearchParams } from "next/navigation"
import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { apiFetch } from "@/lib/client"

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
      const next = params.get("next")
      router.replace(next && next.startsWith("/") && !next.startsWith("//") ? next : "/inbox")
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось войти")
      setPending(false)
    }
  }

  return (
    <form method="post" onSubmit={onSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="email">Почта</Label>
        <Input id="email" name="email" type="email" autoComplete="username" required autoFocus className="h-11" />
      </div>
      <div className="space-y-2">
        <Label htmlFor="password">Пароль</Label>
        <Input id="password" name="password" type="password" autoComplete="current-password" required className="h-11" />
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <Button type="submit" className="h-11 w-full rounded-full text-base" disabled={pending}>
        {pending ? "Входим…" : "Войти"}
      </Button>
    </form>
  )
}
