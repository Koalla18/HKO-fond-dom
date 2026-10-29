"use client"

import { useEffect, useRef } from "react"
import { useSWRConfig } from "swr"

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message)
  }
}

export async function apiFetch<T = unknown>(url: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const { json, ...rest } = init ?? {}
  const res = await fetch(url, {
    ...rest,
    headers: json !== undefined ? { "content-type": "application/json", ...(rest.headers ?? {}) } : rest.headers,
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  })
  if (res.status === 401 && typeof window !== "undefined" && !url.startsWith("/api/auth")) {
    window.location.href = `/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`
  }
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new ApiError((data as { error?: string }).error ?? `Ошибка ${res.status}`, res.status)
  return data as T
}

export const fetcher = <T,>(url: string) => apiFetch<T>(url)

type LiveEvent = { type: string; requestId?: string | null; channelId?: string; messageId?: string; applicationId?: string }

/** Подписка на живые события сервера: при новом сообщении обновляем нужные списки. */
export function useLiveUpdates(onEvent?: (event: LiveEvent) => void) {
  const { mutate } = useSWRConfig()
  const handler = useRef(onEvent)
  useEffect(() => {
    handler.current = onEvent
  }, [onEvent])
  useEffect(() => {
    let source: EventSource | null = null
    let retry: ReturnType<typeof setTimeout>
    const connect = () => {
      source = new EventSource("/api/stream")
      source.onmessage = (msg) => {
        const event = JSON.parse(msg.data) as LiveEvent
        if (event.requestId) {
          void mutate((key) => typeof key === "string" && (key.startsWith("/api/requests") || key.startsWith("/api/dashboard")))
        }
        if (event.channelId) void mutate("/api/channels")
        if (event.applicationId || event.requestId) {
          void mutate((key) => typeof key === "string" && (key.startsWith("/api/applications") || key.startsWith("/api/dashboard")))
        }
        handler.current?.(event)
      }
      source.onerror = () => {
        source?.close()
        retry = setTimeout(connect, 3000)
      }
    }
    connect()
    return () => {
      clearTimeout(retry)
      source?.close()
    }
  }, [mutate])
}
