/** Ошибка площадки с текстом, понятным сотруднику. */
export class ChannelApiError extends Error {
  constructor(
    message: string,
    public retryable = true,
  ) {
    super(message)
  }
}

export async function fetchJson<T = unknown>(url: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<T> {
  const { timeoutMs = 30_000, signal, ...rest } = init
  const timeout = AbortSignal.timeout(timeoutMs)
  const res = await fetch(url, { ...rest, signal: signal ? AbortSignal.any([signal, timeout]) : timeout })
  const body = await res.text()
  let data: unknown = null
  try {
    data = body ? JSON.parse(body) : null
  } catch {
    data = body
  }
  if (!res.ok) {
    const message =
      (data as { description?: string; error?: { message?: string } } | null)?.description ??
      (data as { error?: { message?: string } } | null)?.error?.message ??
      (typeof data === "string" ? data.slice(0, 200) : `HTTP ${res.status}`)
    throw new ChannelApiError(message, res.status >= 500 || res.status === 429)
  }
  return data as T
}

export function sleep(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve) => {
    if (signal?.aborted) return resolve()
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener("abort", () => {
      clearTimeout(timer)
      resolve()
    }, { once: true })
  })
}

/** Длинные ответы режем по абзацам, а не посреди слова. */
export function chunkText(text: string, limit: number): string[] {
  if (text.length <= limit) return [text]
  const parts: string[] = []
  let rest = text
  while (rest.length > limit) {
    let cut = rest.lastIndexOf("\n", limit)
    if (cut < limit * 0.5) cut = rest.lastIndexOf(" ", limit)
    if (cut < limit * 0.5) cut = limit
    parts.push(rest.slice(0, cut).trimEnd())
    rest = rest.slice(cut).trimStart()
  }
  if (rest) parts.push(rest)
  return parts
}

export function greetingText(config: Record<string, unknown>) {
  const greeting = typeof config.greeting === "string" ? config.greeting.trim() : ""
  return greeting || "Здравствуйте! Это фонд «ДОМ». Нашли животное, хотите помочь или взять питомца? Напишите — мы ответим."
}

/** Ждать, пока канал не выключат (для каналов на вебхуках, где опрашивать нечего). */
export function waitForAbort(signal: AbortSignal) {
  return new Promise<void>((resolve) => {
    if (signal.aborted) return resolve()
    signal.addEventListener("abort", () => resolve(), { once: true })
  })
}
