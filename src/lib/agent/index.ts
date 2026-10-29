import { and, asc, eq, notInArray } from "drizzle-orm"
import { db, t } from "@/db"
import type { Message, RequestRow } from "@/db/schema"
import { isApplicationKind, type ApplicationKind } from "@/lib/applications/catalog"
import { DEFAULT_CATEGORIES } from "@/lib/channels/catalog"
import { publish } from "@/lib/events"
import { getSetting } from "@/lib/settings"
import { llmProvider, loadLlmConfig } from "./llm"

/**
 * ИИ-ассистент. На каждое входящее сообщение он разбирает обращение и оформляет заявку
 * на доске «Заявки» (llm.ts — модель с OpenAI-совместимым API, настраивается в Настройках).
 *
 * Режимы: full — обращение ведёт ассистент (может ответить и передать сотруднику);
 * silent — обращение уже ведёт человек: ассистент молча дополняет разбор и заявку, не пишет человеку.
 */

export type AgentInput = {
  request: RequestRow
  history: Message[]
  categories: string[]
  signature: string
  mode: "full" | "silent"
}

export type AgentAction =
  /** Ответить человеку (в т. ч. уточняющий вопрос). */
  | { type: "reply"; text: string }
  /** Разобрать заявку: категория, срочность, краткое изложение для сотрудников. */
  | { type: "classify"; category?: string; priority?: RequestRow["priority"]; summary?: string; subject?: string }
  /** Передать человеку: агент не уверен, тема чувствительная или человек просит сотрудника. */
  | { type: "handoff"; reason: string }
  /** Внутренняя заметка для сотрудников. */
  | { type: "note"; text: string }
  /**
   * Оформить заявку на доске «Заявки»: человек хочет взять питомца, нашёл животное и т. д.
   * Поля — ключи анкеты из lib/applications/catalog.ts; неизвестные отбрасываются.
   */
  | { type: "application"; kind: ApplicationKind; fields: Record<string, unknown>; urgent?: boolean }

export interface AgentProvider {
  id: string
  handle(input: AgentInput): Promise<AgentAction[]>
}

const PROVIDERS: Record<string, AgentProvider> = { llm: llmProvider }

export function registerAgentProvider(provider: AgentProvider) {
  PROVIDERS[provider.id] = provider
}

function providerFor(ai: Awaited<ReturnType<typeof getSetting<"ai">>>): AgentProvider | undefined {
  if (!ai.enabled || ai.provider === "none") return undefined
  return PROVIDERS[ai.provider] ?? PROVIDERS.llm
}

/**
 * По каждому обращению ассистент работает строго по очереди: два сообщения подряд не должны
 * породить две заявки или два ответа. Сервер один — очереди в памяти достаточно.
 */
const queues = new Map<string, Promise<unknown>>()

function enqueue<T>(requestId: string, job: () => Promise<T>): Promise<T> {
  const prev = queues.get(requestId) ?? Promise.resolve()
  const next = prev.catch(() => {}).then(job)
  queues.set(requestId, next)
  void next.finally(() => queues.get(requestId) === next && queues.delete(requestId)).catch(() => {})
  return next
}

/** Дождаться, пока ассистент разберёт всё, что ему отдали (для тестов и проверок). */
export async function agentIdle() {
  while (queues.size) await Promise.allSettled([...queues.values()])
}

export function notifyAgent(event: { requestId: string; messageId: string; createdRequest: boolean }) {
  return enqueue(event.requestId, () => handleIncoming(event))
}

async function handleIncoming(event: { requestId: string; messageId: string; createdRequest: boolean }) {
  try {
    const ai = await getSetting("ai")
    const provider = providerFor(ai)
    if (!provider) return

    const [request] = await db.select().from(t.requests).where(eq(t.requests.id, event.requestId)).limit(1)
    if (!request || request.status === "spam") return
    if (event.createdRequest) await db.update(t.requests).set({ aiHandling: true }).where(eq(t.requests.id, request.id))
    const mode = event.createdRequest || request.aiHandling ? "full" : "silent"
    await runAgent({ ...request, aiHandling: event.createdRequest || request.aiHandling }, provider, mode, ai.signature)
  } catch (err) {
    console.error("[agent]", err)
  }
}

async function runAgent(request: RequestRow, provider: AgentProvider, mode: AgentInput["mode"], signature: string) {
  const history = await db.select().from(t.messages).where(eq(t.messages.requestId, request.id)).orderBy(asc(t.messages.createdAt))
  const actions = await provider.handle({ request, history, categories: DEFAULT_CATEGORIES, signature, mode })
  await applyAgentActions(request, actions, mode)
  return actions
}

/** «Разобрать ассистентом» из карточки обращения: разбор и заявка, без ответа человеку. */
export function runAgentNow(requestId: string) {
  return enqueue(requestId, () => runNow(requestId))
}

async function runNow(requestId: string) {
  const ai = await getSetting("ai")
  // Ручной запуск работает и при выключенном ассистенте — так его проверяют на живом обращении
  // перед тем, как включить для всех.
  if (ai.provider === "none" || !(await loadLlmConfig(ai))) {
    throw new Error("Ассистент не подключён — выберите модель и вставьте ключ: Настройки → ИИ-ассистент")
  }
  const provider = PROVIDERS[ai.provider] ?? PROVIDERS.llm
  const [request] = await db.select().from(t.requests).where(eq(t.requests.id, requestId)).limit(1)
  if (!request) throw new Error("Обращение не найдено")
  return runAgent(request, provider, "silent", ai.signature)
}

export async function applyAgentActions(request: RequestRow, actions: AgentAction[], mode: AgentInput["mode"] = "full") {
  const { sendReply } = await import("@/lib/channels/outbound")
  const { createApplication, updateApplication } = await import("@/lib/applications/service")
  for (const action of actions) {
    if (action.type === "reply") {
      if (mode === "silent") continue
      await sendReply({ requestId: request.id, text: action.text, author: { type: "ai" } })
    } else if (action.type === "classify") {
      // Молча — только дополняем: то, что выставил сотрудник, не трогаем; срочность только повышаем.
      const [current] = await db.select().from(t.requests).where(eq(t.requests.id, request.id)).limit(1)
      const rank = { low: 0, normal: 1, high: 2, urgent: 3 } as const
      const keep = mode === "silent"
      const category = action.category && DEFAULT_CATEGORIES.includes(action.category) ? action.category : undefined
      await db
        .update(t.requests)
        .set({
          ...(category && (!keep || !current.category) ? { category } : {}),
          ...(action.priority && (!keep || rank[action.priority] > rank[current.priority]) ? { priority: action.priority } : {}),
          ...(action.summary ? { summary: action.summary } : {}),
          ...(action.subject && (!keep || !current.subject) ? { subject: action.subject } : {}),
        })
        .where(eq(t.requests.id, request.id))
    } else if (action.type === "handoff") {
      if (mode === "silent") continue
      await db.update(t.requests).set({ aiHandling: false, status: "open" }).where(eq(t.requests.id, request.id))
      await db.insert(t.messages).values({
        requestId: request.id,
        direction: "internal",
        authorType: "ai",
        text: `Передаю сотруднику: ${action.reason}`,
      })
    } else if (action.type === "note") {
      await db.insert(t.messages).values({ requestId: request.id, direction: "internal", authorType: "ai", text: action.text })
    } else if (action.type === "application" && isApplicationKind(action.kind)) {
      // Одна открытая заявка одного вида на обращение — повторный разбор не плодит дубли.
      const [existing] = await db
        .select({ id: t.applications.id })
        .from(t.applications)
        .where(and(eq(t.applications.requestId, request.id), eq(t.applications.kind, action.kind), notInArray(t.applications.stage, ["done", "declined"])))
        .limit(1)
      if (existing) {
        await updateApplication(existing.id, { fields: action.fields }, { type: "ai" })
      } else {
        await createApplication({
          kind: action.kind,
          fields: action.fields,
          urgent: action.urgent,
          strict: false,
          source: "ai",
          requestId: request.id,
          actor: { type: "ai" },
        })
      }
    }
  }
  publish({ type: "request.updated", requestId: request.id })
}
