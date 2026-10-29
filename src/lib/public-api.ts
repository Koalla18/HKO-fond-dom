/** Общее для публичных ручек сайта фонда: CORS и простой лимит частоты. */
export const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type",
  "access-control-max-age": "86400",
}

export function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", ...CORS } })
}

const hits = new Map<string, number[]>()

/** true — лимит превышен. Держим в памяти процесса: сервер один. */
export function rateLimited(key: string, max: number, windowMs: number) {
  const now = Date.now()
  const list = (hits.get(key) ?? []).filter((t) => now - t < windowMs)
  list.push(now)
  hits.set(key, list)
  if (hits.size > 10_000) hits.clear()
  return list.length > max
}

/**
 * Адрес посетителя. Заголовкам X-Forwarded-For / X-Real-IP верим, только если перед платформой
 * стоит свой прокси (TRUST_PROXY=1, например Caddy с HTTPS) — иначе любой подставит в них что угодно
 * и обойдёт лимиты. Без прокси адреса не видно: возвращаем null.
 */
export function clientIp(req: Request): string | null {
  if (process.env.TRUST_PROXY !== "1") return null
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || null
}
