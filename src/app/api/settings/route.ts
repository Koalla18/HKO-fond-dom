import { z } from "zod"
import { api } from "@/lib/auth"
import { decryptJson, encryptJson, maskSecret } from "@/lib/crypto"
import { getSetting, setSetting } from "@/lib/settings"
import { readJson } from "@/lib/validate"

async function aiKeyMask() {
  const { enc } = await getSetting("aiKey")
  if (!enc) return null
  try {
    return maskSecret(decryptJson<{ key: string }>(enc).key)
  } catch {
    return "••••"
  }
}

async function snapshot() {
  return { org: await getSetting("org"), ai: await getSetting("ai"), aiKeyMask: await aiKeyMask(), applications: await getSetting("applications") }
}

export const GET = api(async () => snapshot())

const Body = z.object({
  org: z.object({ name: z.string().trim().min(1).max(100), timezone: z.string().max(60), logoUrl: z.string().max(300).nullable(), site: z.string().max(300).nullable() }).partial().optional(),
  ai: z
    .object({
      enabled: z.boolean(),
      provider: z.enum(["none", "timeweb", "yandexgpt", "gigachat", "deepseek", "openai", "custom"]),
      baseUrl: z.union([z.literal(""), z.string().trim().url().max(300)]),
      model: z.string().trim().max(200),
      folderId: z.string().trim().max(100),
      autoReply: z.boolean(),
      createApplications: z.boolean(),
      signature: z.string().trim().max(100),
      handoffAfter: z.number().int().min(1).max(50),
    })
    .partial()
    .optional(),
  /** Новый ключ API ассистента; пустая строка — не менять, null — удалить. */
  aiKey: z.string().trim().max(500).nullable().optional(),
  applications: z
    .object({
      goals: z.object({ homesPerMonth: z.number().int().min(0).max(1000), replyWithinHourPct: z.number().int().min(0).max(100) }),
    })
    .partial()
    .optional(),
})

export const PATCH = api(
  async (req) => {
    const body = await readJson(req, Body)
    if (body.org) await setSetting("org", body.org)
    if (body.ai) await setSetting("ai", body.ai)
    if (body.aiKey === null) await setSetting("aiKey", { enc: null })
    else if (body.aiKey) await setSetting("aiKey", { enc: encryptJson({ key: body.aiKey }) })
    if (body.applications) await setSetting("applications", body.applications)
    return snapshot()
  },
  { admin: true },
)
