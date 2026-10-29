/** Нарушение уникальности Postgres (23505). Drizzle оборачивает ошибку драйвера в cause. */
export function isUniqueViolation(err: unknown): boolean {
  let current: unknown = err
  for (let i = 0; i < 4 && current; i++) {
    if ((current as { code?: string }).code === "23505") return true
    current = (current as { cause?: unknown }).cause
  }
  return false
}
