import { eq, sql } from "drizzle-orm"
import { db, t } from "@/db"
import type { Channel } from "@/db/schema"
import { decryptJson } from "@/lib/crypto"
import { publish } from "@/lib/events"
import type { ChannelKind } from "./catalog"
import { ChannelApiError, sleep } from "./http"
import { ingestIncoming } from "./ingest"
import { getAdapter } from "./registry"
import { setChannelStatus } from "./store"
import type { AdapterContext, ChannelConfig, ChannelSecrets } from "./types"

type Running = { controller: AbortController; done: Promise<void> }

declare global {
  var __domConnectors: Map<string, Running> | undefined
}

const running: Map<string, Running> = (globalThis.__domConnectors ??= new Map())

export function connectorsEnabled() {
  return process.env.CONNECTORS !== "off"
}

/** Контекст канала для адаптера: приём сообщений, статус, сохранение курсора опроса. */
export function makeContext(channel: Channel, signal: AbortSignal): AdapterContext {
  const config = (channel.config ?? {}) as ChannelConfig
  return {
    channel,
    config,
    secrets: decryptJson<ChannelSecrets>(channel.secrets),
    signal,
    ingest: async (message) => {
      await ingestIncoming(channel, message)
    },
    setStatus: async (status, message = null) => {
      await setChannelStatus(channel.id, status, message)
      publish({ type: "channel.updated", channelId: channel.id })
    },
    saveState: async (patch) => {
      Object.assign(config, patch)
      await db
        .update(t.channels)
        .set({ config: sql`${t.channels.config} || ${JSON.stringify(patch)}::jsonb` })
        .where(eq(t.channels.id, channel.id))
    },
    log: (...args) => console.log(`[${channel.kind}:${channel.name}]`, ...args),
  }
}

async function loop(channel: Channel, controller: AbortController) {
  const adapter = getAdapter(channel.kind as ChannelKind)
  if (!adapter.run) return
  let delay = 5_000
  while (!controller.signal.aborted) {
    const ctx = makeContext(channel, controller.signal)
    try {
      await ctx.setStatus("connecting")
      await adapter.run(ctx)
      delay = 5_000
    } catch (err) {
      if (controller.signal.aborted) break
      const message = err instanceof Error ? err.message : String(err)
      const permanent = err instanceof ChannelApiError && !err.retryable
      ctx.log("ошибка:", message)
      await ctx.setStatus("error", permanent ? message : `${message} — повтор через ${Math.round(delay / 1000)} с`)
      // Неверный ключ сам не исправится: ждём, пока поменяют настройки (перезапуск канала).
      await sleep(permanent ? 10 * 60_000 : delay, controller.signal)
      delay = Math.min(delay * 2, 5 * 60_000)
    }
  }
}

export async function stopChannel(id: string) {
  const current = running.get(id)
  if (!current) return
  running.delete(id)
  current.controller.abort()
  await Promise.race([current.done, sleep(5_000)])
}

/** Перезапустить канал после изменения настроек, включения или выключения. */
export async function restartChannel(id: string) {
  await stopChannel(id)
  const [channel] = await db.select().from(t.channels).where(eq(t.channels.id, id)).limit(1)
  if (!channel) return
  if (!channel.enabled) {
    await setChannelStatus(id, "idle", null)
    publish({ type: "channel.updated", channelId: id })
    return
  }
  if (!connectorsEnabled() || !getAdapter(channel.kind as ChannelKind)?.run) {
    await setChannelStatus(id, "ok", null)
    publish({ type: "channel.updated", channelId: id })
    return
  }
  const controller = new AbortController()
  const done = loop(channel, controller).catch((err) => console.error("[connectors]", err))
  running.set(id, { controller, done })
}

export async function startAllChannels() {
  const channels = await db.select({ id: t.channels.id }).from(t.channels).where(eq(t.channels.enabled, true))
  for (const { id } of channels) await restartChannel(id)
  return channels.length
}

export async function stopAllChannels() {
  await Promise.all([...running.keys()].map(stopChannel))
}
