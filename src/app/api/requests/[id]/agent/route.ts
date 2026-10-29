import { runAgentNow } from "@/lib/agent"
import { api, HttpError } from "@/lib/auth"

type Ctx = { params: Promise<{ id: string }> }

/** «Разобрать ассистентом»: тема, срочность, заявка по переписке. Человеку ничего не уходит. */
export const POST = api(async (_req, ctx: Ctx) => {
  const { id } = await ctx.params
  if (!/^[0-9a-f-]{36}$/.test(id)) throw new HttpError(404, "Обращение не найдено")
  try {
    const actions = await runAgentNow(id)
    return { actions: actions.map((a) => a.type) }
  } catch (err) {
    throw new HttpError(400, (err as Error).message)
  }
})
