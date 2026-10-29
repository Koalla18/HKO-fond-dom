import type { Attachment, RequestPriority, RequestStatus } from "@/db/schema"

/** Формы ответов API — общие для сервера и интерфейса. */

export type ChannelListItem = {
  id: string
  kind: string
  name: string
  enabled: boolean
  config: Record<string, unknown>
  status: "idle" | "connecting" | "ok" | "error"
  statusMessage: string | null
  lastActivityAt: string | null
  createdAt: string
  secretsMasked: Record<string, string | null>
}

export type RequestListItem = {
  id: string
  number: number
  status: RequestStatus
  priority: RequestPriority
  category: string | null
  subject: string | null
  summary: string | null
  aiHandling: boolean
  unread: number
  lastMessageAt: string
  lastMessagePreview: string | null
  lastMessageDirection: "in" | "out" | null
  createdAt: string
  contact: { id: string; name: string; avatarUrl: string | null }
  channel: { id: string; kind: string; name: string }
  assignee: { id: string | null; name: string | null } | null
}

export type RequestListResponse = {
  items: RequestListItem[]
  counts: { active: number; fresh: number; mine: number; unassigned: number; ai: number; unread: number }
  byChannel: Record<string, number>
}

export type ThreadMessage = {
  id: string
  direction: "in" | "out" | "internal"
  authorType: "contact" | "agent" | "ai" | "system"
  authorName: string | null
  text: string
  attachments: Attachment[]
  delivery: "pending" | "sent" | "failed" | null
  deliveryError: string | null
  createdAt: string
  /** На что это сообщение отвечает: id в переписке (если нашли) и короткий текст цитаты. */
  replyTo: { id: string | null; text: string } | null
}

export type RequestDetail = {
  request: {
    id: string
    number: number
    status: RequestStatus
    priority: RequestPriority
    category: string | null
    subject: string | null
    summary: string | null
    aiHandling: boolean
    assigneeId: string | null
    replyTo: string
    createdAt: string
    lastMessageAt: string
    resolvedAt: string | null
  }
  contact: { id: string; name: string; email: string | null; phone: string | null; avatarUrl: string | null; note: string | null; createdAt: string }
  channel: { id: string; kind: string; name: string }
  messages: ThreadMessage[]
  identities: { id: string; externalId: string; handle: string | null; profileUrl: string | null; channel: { id: string; kind: string; name: string } }[]
  history: { id: string; number: number; status: RequestStatus; subject: string | null; lastMessagePreview: string | null; createdAt: string; channel: { kind: string; name: string } }[]
}

export type TeamUser = { id: string; email: string; name: string; role: "admin" | "agent"; active: boolean }

export type MeResponse = {
  user: { id: string; email: string; name: string; role: "admin" | "agent" }
  org: { name: string; timezone: string; logoUrl: string | null; site: string | null }
  ai: { enabled: boolean; provider: string; signature: string; handoffAfter: number }
}

export type ApplicationListItem = {
  id: string
  number: number
  kind: string
  stage: import("@/db/schema").ApplicationStage
  title: string
  urgent: boolean
  source: import("@/db/schema").ApplicationSource
  fields: Record<string, string | string[] | boolean>
  requestId: string | null
  createdAt: string
  updatedAt: string
  stageChangedAt: string
  contact: { id: string | null; name: string | null; phone: string | null; email: string | null; avatarUrl: string | null } | null
  assignee: { id: string | null; name: string | null } | null
  channelKind: string | null
}

export type ApplicationListResponse = {
  items: ApplicationListItem[]
  /** Сколько открытых заявок каждого вида (для вкладок). */
  byKind: Record<string, number>
  /** Сколько заявок на каждом этапе при текущих фильтрах (кроме этапа). */
  byStage: Record<string, number>
  total: number
}

export type ApplicationEventItem = {
  id: string
  type: "created" | "stage" | "assigned" | "updated" | "note"
  fromStage: string | null
  toStage: string | null
  text: string | null
  authorType: "agent" | "ai" | "system" | "contact"
  authorName: string | null
  createdAt: string
}

export type ApplicationDetail = {
  application: ApplicationListItem & { outcome: string | null; closedAt: string | null }
  request: { id: string; number: number; status: string; subject: string | null; channel: { kind: string; name: string } } | null
  events: ApplicationEventItem[]
  /** Другие заявки этого человека. */
  related: { id: string; number: number; kind: string; stage: string; title: string; createdAt: string }[]
}
