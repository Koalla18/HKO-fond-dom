import { z } from "zod"
import type { Message } from "@/db/schema"
import { APPLICATION_KIND_ORDER, APPLICATION_KINDS, isApplicationKind } from "@/lib/applications/catalog"
import { decryptJson } from "@/lib/crypto"
import { getSetting, type AiSettings } from "@/lib/settings"
import { presetOf } from "./presets"
import type { AgentAction, AgentInput, AgentProvider } from "./index"

/**
 * Ассистент на любой модели с OpenAI-совместимым API. Модель получает переписку и
 * отвечает одним JSON: тема, срочность, категория, заявка с ответами анкеты, ответ человеку,
 * передача сотруднику. Платформа превращает это в действия (agent/index.ts).
 */

const ModelAnswer = z.object({
  reply: z.string().nullish(),
  category: z.string().nullish(),
  priority: z.enum(["low", "normal", "high", "urgent"]).nullish(),
  subject: z.string().nullish(),
  summary: z.string().nullish(),
  application: z
    .object({ kind: z.string(), fields: z.record(z.string(), z.unknown()).default({}), urgent: z.boolean().nullish() })
    .nullish(),
  handoff: z.string().nullish(),
  note: z.string().nullish(),
})
export type ModelAnswer = z.infer<typeof ModelAnswer>

export type LlmConfig = { baseUrl: string; model: string; apiKey: string; folderId?: string; redact: boolean }

/** Описание видов заявок для модели: ключи полей и допустимые варианты — ровно как в каталоге. */
function kindsForPrompt() {
  return APPLICATION_KIND_ORDER.map((kind) => {
    const meta = APPLICATION_KINDS[kind]
    const fields = meta.fields
      .map((f) => {
        const opts = f.options ? ` — один из: ${f.options.map((o) => `"${o}"`).join(", ")}${f.type === "chips" ? " (массив)" : ""}` : f.type === "boolean" ? " — true/false" : " — текст"
        return `    ${f.key}: ${f.label}${opts}`
      })
      .join("\n")
    return `- ${kind} «${meta.title}»: ${meta.description}\n${fields}`
  }).join("\n")
}

export function systemPrompt(input: { orgName: string; site: string | null; categories: string[]; signature: string; autoReply: boolean; createApplications: boolean }) {
  return `Ты — ${input.signature}, помощник команды «${input.orgName}» (фонд помощи бездомным собакам и кошкам, Долгопрудный и Москва${input.site ? `, сайт ${input.site}` : ""}).
Тебе приходит переписка с человеком из любого канала: ВКонтакте, Telegram, почта, сайт, MAX, Одноклассники.

Твоя работа:
1. Понять, что нужно человеку, и разобрать обращение для сотрудников: короткая тема, суть в 1–2 предложениях, категория, срочность.
2. ${input.createApplications ? "Если человеку нужна помощь фонда или он предлагает помощь — оформить заявку одного из видов ниже и заполнить поля анкеты тем, что он уже написал. Не выдумывай: неизвестное поле пропусти." : "Заявки не оформляй (application: null)."}
3. ${input.autoReply ? "Ответить человеку по-русски, коротко и тепло: подтвердить, что фонд получил сообщение, и задать уточняющие вопросы, без которых фонд не поможет (адрес, фото, состояние животного, контакт). Не обещай того, что решают сотрудники: деньги, сроки, приезд, лечение." : "Людям не отвечай сам (reply: null) — ответят сотрудники."}
4. Передать сотруднику (handoff — причина), если: деньги, документы, жалоба, СМИ, угроза жизни человека, агрессия, или ты не уверен.

Срочность urgent — животное ранено, сбито, истощено, котята или щенки без мамы, угроза жизни. high — СМИ и всё, что нужно сегодня. Остальное normal.
Категория — одна из: ${input.categories.join(", ")}.

Виды заявок (kind) и поля анкеты (fields):
${kindsForPrompt()}

Ответь ТОЛЬКО JSON-объектом без пояснений:
{"reply": string|null, "category": string|null, "priority": "low"|"normal"|"high"|"urgent", "subject": string|null, "summary": string|null,
 "application": {"kind": string, "fields": object, "urgent": boolean}|null, "handoff": string|null, "note": string|null}`
}

/** Для моделей за рубежом: телефоны и почты в тексте заменяются — ассистенту они не нужны. */
export function redact(text: string) {
  return text
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "[почта]")
    .replace(/(?:\+7|8)[\s(-]*\d{3}[\s)-]*\d{3}[\s-]*\d{2}[\s-]*\d{2}/g, "[телефон]")
}

export function historyForModel(history: Message[], cfg: { redact: boolean }) {
  return history
    .filter((m) => m.direction !== "internal" && m.text.trim())
    .slice(-20)
    .map((m) => ({
      role: m.direction === "in" ? ("user" as const) : ("assistant" as const),
      content: (cfg.redact ? redact(m.text) : m.text).slice(0, 4000) + (m.attachments.length ? `\n[вложений: ${m.attachments.length}]` : ""),
    }))
}

export function parseModelAnswer(text: string): ModelAnswer | null {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "")
  const start = cleaned.indexOf("{")
  const end = cleaned.lastIndexOf("}")
  if (start < 0 || end <= start) return null
  try {
    const parsed = ModelAnswer.safeParse(JSON.parse(cleaned.slice(start, end + 1)))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

export async function callModel(cfg: LlmConfig, messages: { role: "system" | "user" | "assistant"; content: string }[]) {
  const url = `${cfg.baseUrl.replace(/\/$/, "")}/chat/completions`
  const headers: Record<string, string> = { "content-type": "application/json", authorization: `Bearer ${cfg.apiKey}` }
  if (cfg.folderId) headers["OpenAI-Project"] = cfg.folderId
  const model = cfg.model.replace("{folder}", cfg.folderId ?? "")
  const body = { model, messages, temperature: 0.2, response_format: { type: "json_object" } }
  const post = (b: unknown) => fetch(url, { method: "POST", headers, body: JSON.stringify(b), signal: AbortSignal.timeout(60_000) })
  let res = await post(body)
  // Не все сервисы понимают response_format — повторяем без него.
  if (res.status === 400) res = await post({ ...body, response_format: undefined })
  const data = (await res.json().catch(() => ({}))) as { choices?: { message?: { content?: string } }[]; error?: { message?: string } | string }
  if (!res.ok) {
    const reason = typeof data.error === "string" ? data.error : data.error?.message
    throw new Error(`Модель ответила ${res.status}${reason ? `: ${reason}` : ""}`)
  }
  return data.choices?.[0]?.message?.content ?? ""
}

/** Настройки и ключ ассистента: null — не настроен. */
export async function loadLlmConfig(ai?: AiSettings): Promise<LlmConfig | null> {
  const settings = ai ?? (await getSetting("ai"))
  if (settings.provider === "none") return null
  const preset = presetOf(settings.provider)
  const { enc } = await getSetting("aiKey")
  const apiKey = enc ? decryptJson<{ key: string }>(enc).key : ""
  const baseUrl = settings.baseUrl || preset?.baseUrl || ""
  const model = settings.model || preset?.model || ""
  if (!apiKey || !baseUrl || !model) return null
  return { baseUrl, model, apiKey, folderId: settings.folderId || undefined, redact: !(settings.provider === "yandexgpt" || settings.provider === "gigachat") }
}

/** Ответ модели → действия платформы с учётом режима и настроек. */
export function toActions(answer: ModelAnswer, input: { mode: "full" | "silent"; autoReply: boolean; createApplications: boolean; signature: string; aiReplies: number; handoffAfter: number }): AgentAction[] {
  const actions: AgentAction[] = []
  if (answer.category || answer.priority || answer.summary || answer.subject) {
    actions.push({
      type: "classify",
      category: answer.category ?? undefined,
      priority: answer.priority ?? undefined,
      summary: answer.summary?.slice(0, 600) ?? undefined,
      subject: answer.subject?.slice(0, 120) ?? undefined,
    })
  }
  if (input.createApplications && answer.application && isApplicationKind(answer.application.kind)) {
    actions.push({ type: "application", kind: answer.application.kind, fields: answer.application.fields, urgent: answer.application.urgent ?? undefined })
  }
  if (answer.note) actions.push({ type: "note", text: answer.note.slice(0, 2000) })
  if (input.mode === "silent") return actions

  if (input.aiReplies >= input.handoffAfter) {
    actions.push({ type: "handoff", reason: `ассистент ответил ${input.aiReplies} раз — дальше лучше человеку` })
    return actions
  }
  if (input.autoReply && answer.reply?.trim()) {
    let text = answer.reply.trim().slice(0, 2000)
    // Человек должен понимать, что ему отвечает ассистент, — в первом ответе представляемся.
    if (input.aiReplies === 0 && !/ассистент/i.test(text)) text = `${input.signature}:\n${text}`
    actions.push({ type: "reply", text })
  }
  if (answer.handoff?.trim()) actions.push({ type: "handoff", reason: answer.handoff.trim().slice(0, 300) })
  return actions
}

export const llmProvider: AgentProvider = {
  id: "llm",
  async handle(input: AgentInput) {
    const ai = await getSetting("ai")
    const cfg = await loadLlmConfig(ai)
    if (!cfg) return []
    const org = await getSetting("org")
    const raw = await callModel(cfg, [
      { role: "system", content: systemPrompt({ orgName: org.name, site: org.site, categories: input.categories, signature: ai.signature, autoReply: ai.autoReply, createApplications: ai.createApplications }) },
      ...historyForModel(input.history, cfg),
    ])
    const answer = parseModelAnswer(raw)
    if (!answer) return [{ type: "note", text: "Ассистент не смог разобрать обращение — ответ модели непонятен." }]
    return toActions(answer, {
      mode: input.mode,
      autoReply: ai.autoReply,
      createApplications: ai.createApplications,
      signature: ai.signature,
      aiReplies: input.history.filter((m) => m.direction === "out" && m.authorType === "ai").length,
      handoffAfter: ai.handoffAfter,
    })
  },
}

