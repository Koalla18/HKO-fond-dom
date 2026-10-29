import { z } from "zod"
import { DEFAULT_CATEGORIES } from "@/lib/channels/catalog"
import { api, HttpError } from "@/lib/auth"
import { callModel, loadLlmConfig, parseModelAnswer, systemPrompt, toActions } from "@/lib/agent/llm"
import { getSetting } from "@/lib/settings"
import { readJson } from "@/lib/validate"

const Body = z.object({ text: z.string().trim().min(3).max(2000) })

/** Проверка ассистента на примере: что он поймёт и что сделает. В базу ничего не пишет. */
export const POST = api(
  async (req) => {
    const { text } = await readJson(req, Body)
    const ai = await getSetting("ai")
    const cfg = await loadLlmConfig(ai)
    if (!cfg) throw new HttpError(400, "Выберите сервис и сохраните ключ API")
    const org = await getSetting("org")
    const started = Date.now()
    let raw: string
    try {
      raw = await callModel(cfg, [
        { role: "system", content: systemPrompt({ orgName: org.name, site: org.site, categories: DEFAULT_CATEGORIES, signature: ai.signature, autoReply: ai.autoReply, createApplications: ai.createApplications }) },
        { role: "user", content: text },
      ])
    } catch (err) {
      throw new HttpError(502, (err as Error).message)
    }
    const answer = parseModelAnswer(raw)
    if (!answer) throw new HttpError(502, "Модель ответила не в том формате — попробуйте другую модель")
    const actions = toActions(answer, { mode: "full", autoReply: ai.autoReply, createApplications: ai.createApplications, signature: ai.signature, aiReplies: 0, handoffAfter: ai.handoffAfter })
    return { ms: Date.now() - started, actions }
  },
  { admin: true },
)
