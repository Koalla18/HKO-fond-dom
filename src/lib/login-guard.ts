/**
 * Защита входа от подбора пароля. Сервер один — счётчики в памяти процесса.
 *
 *  • на учётную запись: 5 неверных паролей за 15 минут — вход в неё закрыт на 15 минут
 *    (подбор пароля конкретного сотрудника, с любых адресов);
 *  • на адрес посетителя: 20 за 15 минут — только когда адрес надёжен (свой прокси, TRUST_PROXY=1);
 *  • на всю платформу: 300 за 15 минут — перебор многих почт сразу («распыление»).
 *
 * Ответ одинаковый «Слишком много попыток»: по нему нельзя понять, есть ли такая почта.
 */
const WINDOW = 15 * 60_000
const LIMITS = { account: 5, ip: 20, global: 300 }

type Slot = { n: number; since: number }
const failures = new Map<string, Slot>()

function slot(key: string, now: number): Slot {
  const s = failures.get(key)
  return s && now - s.since < WINDOW ? s : { n: 0, since: now }
}

function keys(email: string, ip: string | null) {
  return [
    ["account", `a:${email}`],
    ...(ip ? [["ip", `i:${ip}`]] : []),
    ["global", "g"],
  ] as [keyof typeof LIMITS, string][]
}

/** Через сколько минут снова можно пробовать; 0 — можно сейчас. */
export function loginBlockedFor(email: string, ip: string | null, now = Date.now()): number {
  for (const [kind, key] of keys(email, ip)) {
    const s = slot(key, now)
    if (s.n >= LIMITS[kind]) return Math.max(1, Math.ceil((s.since + WINDOW - now) / 60_000))
  }
  return 0
}

export function recordLoginFailure(email: string, ip: string | null, now = Date.now()) {
  if (failures.size > 50_000) {
    for (const [k, s] of failures) if (now - s.since >= WINDOW) failures.delete(k)
  }
  for (const [, key] of keys(email, ip)) {
    const s = slot(key, now)
    failures.set(key, { n: s.n + 1, since: s.since })
  }
}

/** Успешный вход сбрасывает счётчики этой учётной записи и адреса (но не общий). */
export function recordLoginSuccess(email: string, ip: string | null) {
  failures.delete(`a:${email}`)
  if (ip) failures.delete(`i:${ip}`)
}

export function resetLoginGuard() {
  failures.clear()
}
