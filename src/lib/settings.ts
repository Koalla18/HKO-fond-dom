import { eq } from "drizzle-orm"
import { db, t } from "@/db"

import type { AiProvider } from "@/lib/agent/presets"

export type AiSettings = {
  enabled: boolean
  provider: AiProvider
  /** Адрес OpenAI-совместимого API и модель (подставляются из выбранного сервиса, можно поменять). */
  baseUrl: string
  model: string
  /** Yandex Cloud: ID каталога. */
  folderId: string
  /** Отвечать людям самому. Выключено — ассистент только разбирает обращения и оформляет заявки. */
  autoReply: boolean
  /** Оформлять заявки на доске «Заявки». */
  createApplications: boolean
  /** Как агент подписывается — люди должны понимать, что им отвечает ассистент. */
  signature: string
  /** Сколько сообщений агент ведёт сам, прежде чем позвать человека. */
  handoffAfter: number
}

export type OrgSettings = { name: string; timezone: string; logoUrl: string | null; site: string | null }

export type ApplicationSettings = {
  /** Цели месяца для обзора. */
  goals: { homesPerMonth: number; replyWithinHourPct: number }
}

/** Ключ API ассистента — только зашифрованным (APP_SECRET), наружу не отдаётся. */
export type AiKeySettings = { enc: string | null }

const DEFAULTS: { org: OrgSettings; ai: AiSettings; aiKey: AiKeySettings; applications: ApplicationSettings } = {
  org: { name: "ДОМ — фонд помощи животным", timezone: "Europe/Moscow", logoUrl: "/brand/fundhome-logo.svg", site: "https://fundhome.ru" },
  ai: {
    enabled: false,
    provider: "none",
    baseUrl: "",
    model: "",
    folderId: "",
    autoReply: false,
    createApplications: true,
    signature: "Ассистент фонда «ДОМ»",
    handoffAfter: 6,
  },
  aiKey: { enc: null },
  applications: {
    goals: { homesPerMonth: 10, replyWithinHourPct: 90 },
  },
}

type Keys = keyof typeof DEFAULTS

export async function getSetting<K extends Keys>(key: K): Promise<(typeof DEFAULTS)[K]> {
  const [row] = await db.select().from(t.settings).where(eq(t.settings.key, key)).limit(1)
  return { ...DEFAULTS[key], ...((row?.value as object) ?? {}) } as (typeof DEFAULTS)[K]
}

export async function setSetting<K extends Keys>(key: K, value: Partial<(typeof DEFAULTS)[K]>) {
  const next = { ...(await getSetting(key)), ...value }
  await db
    .insert(t.settings)
    .values({ key, value: next })
    .onConflictDoUpdate({ target: t.settings.key, set: { value: next, updatedAt: new Date() } })
  return next
}
