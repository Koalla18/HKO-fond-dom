import { format, formatDistanceToNowStrict, isThisYear, isToday, isYesterday } from "date-fns"
import { ru } from "date-fns/locale"

export function shortTime(value: string | Date) {
  const d = new Date(value)
  if (isToday(d)) return format(d, "HH:mm")
  if (isYesterday(d)) return "вчера"
  return format(d, isThisYear(d) ? "d MMM" : "d MMM yyyy", { locale: ru })
}

export function fullTime(value: string | Date) {
  return format(new Date(value), "d MMMM yyyy, HH:mm", { locale: ru })
}

export function ago(value: string | Date) {
  return formatDistanceToNowStrict(new Date(value), { locale: ru, addSuffix: true })
}

export function initials(name: string) {
  const parts = name.replace(/[^\p{L}\p{N}\s]/gu, " ").trim().split(/\s+/).filter(Boolean)
  return ((parts[0]?.[0] ?? "?") + (parts[1]?.[0] ?? "")).toUpperCase()
}

export function plural(n: number, one: string, few: string, many: string) {
  const m10 = n % 10
  const m100 = n % 100
  if (m10 === 1 && m100 !== 11) return one
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few
  return many
}
