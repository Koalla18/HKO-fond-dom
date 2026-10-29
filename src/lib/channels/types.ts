import type { Attachment, Channel, Contact, Message, RequestRow } from "@/db/schema"
import type { ChannelKind } from "./catalog"

/** Входящее сообщение в общем виде — так его отдаёт любой адаптер канала. */
export type IncomingMessage = {
  /** Кто пишет: id пользователя ВК, id чата Telegram, адрес почты… */
  externalUserId: string
  /** Куда отвечать. Чаще всего совпадает с externalUserId. */
  replyTo: string
  name?: string
  handle?: string
  profileUrl?: string
  email?: string
  phone?: string
  avatarUrl?: string
  text: string
  subject?: string
  attachments?: Attachment[]
  /** id сообщения в источнике — повторная доставка не создаст дубль. */
  externalMessageId?: string
  /** Ключи переписки (Message-ID писем), по которым ответ попадает в ту же заявку. */
  threadKeys?: string[]
  meta?: Record<string, unknown>
  receivedAt?: Date
}

export type ChannelSecrets = Record<string, string>
export type ChannelConfig = Record<string, unknown>

export type AdapterContext = {
  channel: Channel
  config: ChannelConfig
  secrets: ChannelSecrets
  /** Прервать опрос: канал выключили, поменяли настройки или сервер останавливается. */
  signal: AbortSignal
  ingest: (message: IncomingMessage) => Promise<void>
  setStatus: (status: "connecting" | "ok" | "error", message?: string | null) => Promise<void>
  /** Сохранить служебное состояние канала (курсор опроса и т. п.) в config. */
  saveState: (patch: ChannelConfig) => Promise<void>
  log: (...args: unknown[]) => void
}

export type SendContext = {
  channel: Channel
  config: ChannelConfig
  secrets: ChannelSecrets
  request: RequestRow
  contact: Contact
  text: string
  attachments: Attachment[]
  /** Последнее входящее — для писем (In-Reply-To). */
  lastIncoming?: Message
  /** Сообщение, на которое отвечаем: площадки с ответами показывают его цитатой. */
  replyTo?: Message | null
}

export type SendResult = { externalId?: string; meta?: Record<string, unknown> }

export type ChannelAdapter = {
  kind: ChannelKind
  /** Долгий цикл получения сообщений. Должен завершиться по ctx.signal. */
  run?: (ctx: AdapterContext) => Promise<void>
  /** Проверка ключей: возвращает человекочитаемое «кто мы» — имя бота, адрес ящика. */
  test?: (ctx: Omit<AdapterContext, "ingest" | "signal">) => Promise<string>
  send?: (ctx: SendContext) => Promise<SendResult>
  /** Приём вебхука площадки (Telegram, Meta, WhatsApp, ВК Callback). */
  webhook?: (req: Request, ctx: AdapterContext, rawBody: string) => Promise<Response>
}
