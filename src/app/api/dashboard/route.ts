import { api } from "@/lib/auth"
import { loadDashboard, type DashboardPeriod } from "@/lib/dashboard"

/** Данные обзора: цифры за неделю, месяц или год с прошлым периодом для сравнения. */
export const GET = api(async (req, _ctx, user) => {
  const p = new URL(req.url).searchParams.get("period")
  const period: DashboardPeriod = p === "month" || p === "year" ? p : "week"
  return loadDashboard(period, user)
})
