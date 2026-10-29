import { z } from "zod"
import { api } from "@/lib/auth"
import { sendReply } from "@/lib/channels/outbound"
import { readJson } from "@/lib/validate"

const Body = z.object({
  text: z.string().max(20000).default(""),
  internal: z.boolean().default(false),
  replyToId: z.string().uuid().nullish(),
  attachments: z
    .array(z.object({ name: z.string(), mime: z.string(), size: z.number().optional(), url: z.string().regex(/^\/api\/files\/[0-9a-f-]{36}$/) }))
    .max(10)
    .default([]),
})

type Ctx = { params: Promise<{ id: string }> }

/** Ответ человеку в его канал или внутренняя заметка для коллег. */
export const POST = api(async (req, ctx: Ctx, user) => {
  const { id } = await ctx.params
  const body = await readJson(req, Body)
  const message = await sendReply({
    requestId: id,
    text: body.text,
    attachments: body.attachments,
    internal: body.internal,
    replyToId: body.replyToId,
    author: { type: "agent", userId: user.id },
  })
  return { message }
})
