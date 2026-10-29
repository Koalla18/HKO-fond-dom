import { APPLICATION_KINDS, fieldText, isApplicationKind, stageLabel } from "@/lib/applications/catalog"
import { filtersFromUrl, listApplications } from "@/lib/applications/query"
import { api } from "@/lib/auth"

const SOURCE: Record<string, string> = { site: "Анкета на сайте", form: "Форма сайта фонда", inbox: "Из обращения", manual: "Вручную", ai: "Ассистент" }

function cell(value: unknown) {
  const s = String(value ?? "")
  // Excel не должен принять ячейку за формулу.
  const safe = /^[=+\-@]/.test(s) ? `'${s}` : s
  return /[";\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
}

/** Выгрузка заявок в CSV для Excel: точка с запятой, BOM, даты по Москве. */
export const GET = api(async (req, _ctx, user) => {
  const url = new URL(req.url)
  const filters = filtersFromUrl(url, user.id)
  const items = await listApplications(filters, 5000)
  const kind = isApplicationKind(filters.kind) ? filters.kind : null
  const kindFields = kind ? APPLICATION_KINDS[kind].fields : []
  const date = new Intl.DateTimeFormat("ru-RU", { timeZone: "Europe/Moscow", dateStyle: "short", timeStyle: "short" })
  const head = ["№", "Создана", "Вид", "Этап", "Срочно", "Заявка", "Имя", "Телефон", "Почта", "Ответственный", "Источник", "Итог"]
  const rows = [
    [...head, ...(kind ? kindFields.map((f) => f.label) : ["Анкета"])],
    ...items.map((a) => {
      const meta = isApplicationKind(a.kind) ? APPLICATION_KINDS[a.kind] : null
      const answers = kind
        ? kindFields.map((f) => fieldText(a.fields[f.key]))
        : [
            (meta?.fields ?? [])
              .filter((f) => fieldText(a.fields[f.key]))
              .map((f) => `${f.label}: ${fieldText(a.fields[f.key])}`)
              .join("; "),
          ]
      return [
        a.number,
        date.format(new Date(a.createdAt)),
        meta?.title ?? a.kind,
        stageLabel(a.kind, a.stage),
        a.urgent ? "да" : "",
        a.title,
        a.contact?.name ?? "",
        a.contact?.phone ?? "",
        a.contact?.email ?? "",
        a.assignee?.name ?? "",
        SOURCE[a.source] ?? a.source,
        a.outcome ?? "",
        ...answers,
      ]
    }),
  ]
  const csv = "﻿" + rows.map((r) => r.map(cell).join(";")).join("\r\n")
  const stamp = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Moscow" }).format(new Date())
  return new Response(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="zayavki-${kind ?? "vse"}-${stamp}.csv"`,
      "cache-control": "no-store",
    },
  })
})
