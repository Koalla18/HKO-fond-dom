import { eq } from "drizzle-orm"
import { db, t } from "@/db"
import type { Channel } from "@/db/schema"
import { decryptJson, encryptJson, maskSecret } from "@/lib/crypto"
import { CHANNELS, type ChannelKind } from "./catalog"
import type { ChannelConfig, ChannelSecrets } from "./types"

export async function loadChannel(id: string) {
  const [channel] = await db.select().from(t.channels).where(eq(t.channels.id, id)).limit(1)
  if (!channel) return null
  return { channel, config: channel.config as ChannelConfig, secrets: decryptJson<ChannelSecrets>(channel.secrets) }
}

/** Канал для интерфейса: секреты только маской. */
export function publicChannel(channel: Channel) {
  const meta = CHANNELS[channel.kind as ChannelKind]
  let secretsMasked: Record<string, string | null> = {}
  try {
    const secrets = decryptJson<ChannelSecrets>(channel.secrets)
    secretsMasked = Object.fromEntries(
      (meta?.fields ?? []).filter((f) => f.secret).map((f) => [f.key, maskSecret(secrets[f.key])]),
    )
  } catch {
    secretsMasked = {}
  }
  const { secrets: _drop, ...rest } = channel
  void _drop
  // Служебное состояние опроса (курсоры) и ключ вебхука ОК интерфейсу не нужны.
  const config = Object.fromEntries(Object.entries(channel.config ?? {}).filter(([k]) => !k.startsWith("_") && k !== "webhookKey"))
  return { ...rest, config, secretsMasked }
}

/** Слить новые секреты со старыми: пустое поле или маска «••••» не стирают сохранённое значение. */
export function mergeSecrets(current: ChannelSecrets, incoming: Record<string, unknown>): string {
  const next: ChannelSecrets = { ...current }
  for (const [key, value] of Object.entries(incoming)) {
    if (typeof value !== "string") continue
    const v = value.trim()
    if (!v || v.startsWith("••••")) continue
    next[key] = v
  }
  return encryptJson(next)
}

export async function setChannelStatus(id: string, status: Channel["status"], message: string | null = null) {
  await db.update(t.channels).set({ status, statusMessage: message }).where(eq(t.channels.id, id))
}

/** Оставить в настройках только поля из каталога канала (несекретные), с умолчаниями. */
export function cleanConfig(kind: ChannelKind, config: Record<string, unknown>) {
  const allowed = new Set(CHANNELS[kind].fields.filter((f) => !f.secret).map((f) => f.key))
  const clean: Record<string, unknown> = {}
  for (const field of CHANNELS[kind].fields) if (!field.secret && field.default !== undefined) clean[field.key] = field.default
  for (const [key, value] of Object.entries(config)) if (allowed.has(key)) clean[key] = value
  return clean
}
