import { sql } from "drizzle-orm"
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core"

/** Сотрудники фонда, которые работают с заявками. */
export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  role: text("role", { enum: ["admin", "agent"] }).notNull().default("agent"),
  passwordHash: text("password_hash").notNull(),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
})

export const sessions = pgTable(
  "sessions",
  {
    id: text("id").primaryKey(), // sha256 от токена из куки
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
)

/**
 * Подключённый источник заявок: конкретный почтовый ящик, сообщество ВК,
 * бот Telegram и т. д. Несекретные настройки — в config, ключи и пароли —
 * в secrets (зашифровано AES-256-GCM ключом APP_SECRET).
 */
export const channels = pgTable("channels", {
  id: uuid("id").primaryKey().defaultRandom(),
  kind: text("kind").notNull(),
  name: text("name").notNull(),
  enabled: boolean("enabled").notNull().default(false),
  config: jsonb("config").$type<Record<string, unknown>>().notNull().default({}),
  secrets: text("secrets"),
  status: text("status", { enum: ["idle", "connecting", "ok", "error"] })
    .notNull()
    .default("idle"),
  statusMessage: text("status_message"),
  lastActivityAt: timestamp("last_activity_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
})

/** Человек, который пишет в фонд. Один контакт — много способов связи. */
export const contacts = pgTable(
  "contacts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    email: text("email"),
    phone: text("phone"),
    avatarUrl: text("avatar_url"),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("contacts_email_idx").on(t.email), index("contacts_phone_idx").on(t.phone)],
)

/** Как найти контакт в конкретном канале: id пользователя ВК, чат Telegram, адрес почты. */
export const contactIdentities = pgTable(
  "contact_identities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    channelId: uuid("channel_id")
      .notNull()
      .references(() => channels.id, { onDelete: "cascade" }),
    externalId: text("external_id").notNull(),
    handle: text("handle"),
    profileUrl: text("profile_url"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("contact_identities_channel_external_uq").on(t.channelId, t.externalId),
    index("contact_identities_contact_idx").on(t.contactId),
  ],
)

export const REQUEST_STATUSES = ["new", "open", "waiting", "resolved", "spam"] as const
export type RequestStatus = (typeof REQUEST_STATUSES)[number]

export const REQUEST_PRIORITIES = ["low", "normal", "high", "urgent"] as const
export type RequestPriority = (typeof REQUEST_PRIORITIES)[number]

/** Заявка — одно обращение человека, из какого бы канала оно ни пришло. */
export const requests = pgTable(
  "requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    number: serial("number").notNull().unique(),
    channelId: uuid("channel_id")
      .notNull()
      .references(() => channels.id),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contacts.id),
    /** Куда отвечать: peer_id ВК, chat_id Telegram, адрес почты и т. п. */
    replyTo: text("reply_to").notNull(),
    subject: text("subject"),
    status: text("status", { enum: REQUEST_STATUSES }).notNull().default("new"),
    priority: text("priority", { enum: REQUEST_PRIORITIES }).notNull().default("normal"),
    category: text("category"),
    assigneeId: uuid("assignee_id").references(() => users.id, { onDelete: "set null" }),
    /** Краткое изложение — заполнит ИИ-агент, пока пусто. */
    summary: text("summary"),
    /** Заявку ведёт ИИ-агент (пока он не подключён — всегда false). */
    aiHandling: boolean("ai_handling").notNull().default(false),
    unread: integer("unread").notNull().default(0),
    lastMessageAt: timestamp("last_message_at", { withTimezone: true }).notNull().defaultNow(),
    lastMessagePreview: text("last_message_preview"),
    lastMessageDirection: text("last_message_direction"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  },
  (t) => [
    index("requests_status_last_idx").on(t.status, t.lastMessageAt),
    index("requests_channel_contact_idx").on(t.channelId, t.contactId),
    index("requests_assignee_idx").on(t.assigneeId),
  ],
)

export type Attachment = {
  name: string
  mime: string
  size?: number
  /** Внутренняя ссылка /api/files/... или внешний адрес, если скачать не вышло. */
  url: string
}

/**
 * Сообщение в заявке.
 * direction: in — от человека, out — ответ фонда, internal — заметка
 * сотрудников или системное событие (их человек не видит).
 */
export const messages = pgTable(
  "messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    requestId: uuid("request_id")
      .notNull()
      .references(() => requests.id, { onDelete: "cascade" }),
    channelId: uuid("channel_id").references(() => channels.id, { onDelete: "set null" }),
    direction: text("direction", { enum: ["in", "out", "internal"] }).notNull(),
    authorType: text("author_type", { enum: ["contact", "agent", "ai", "system"] }).notNull(),
    authorUserId: uuid("author_user_id").references(() => users.id, { onDelete: "set null" }),
    text: text("text").notNull().default(""),
    attachments: jsonb("attachments").$type<Attachment[]>().notNull().default([]),
    /** id сообщения в источнике — защита от дублей при повторной доставке. */
    externalId: text("external_id"),
    delivery: text("delivery", { enum: ["pending", "sent", "failed"] }),
    deliveryError: text("delivery_error"),
    meta: jsonb("meta").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("messages_request_idx").on(t.requestId, t.createdAt),
    uniqueIndex("messages_channel_external_uq")
      .on(t.channelId, t.externalId)
      .where(sql`${t.externalId} is not null`),
  ],
)

export const APPLICATION_STAGES = ["new", "review", "in_progress", "done", "declined"] as const
export type ApplicationStage = (typeof APPLICATION_STAGES)[number]

export const APPLICATION_SOURCES = ["site", "form", "inbox", "manual", "ai"] as const
export type ApplicationSource = (typeof APPLICATION_SOURCES)[number]

/**
 * Заявка — оформленная просьба или предложение по одному из видов помощи фонда:
 * нашли животное, хотят взять питомца, опекать, взять на передержку и т. д.
 * Переписка с человеком живёт в обращении (requests); заявка ссылается на него.
 */
export const applications = pgTable(
  "applications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    number: serial("number").notNull().unique(),
    kind: text("kind").notNull(),
    stage: text("stage", { enum: APPLICATION_STAGES }).notNull().default("new"),
    title: text("title").notNull(),
    urgent: boolean("urgent").notNull().default(false),
    contactId: uuid("contact_id").references(() => contacts.id, { onDelete: "set null" }),
    requestId: uuid("request_id").references(() => requests.id, { onDelete: "set null" }),
    source: text("source", { enum: APPLICATION_SOURCES }).notNull().default("manual"),
    assigneeId: uuid("assignee_id").references(() => users.id, { onDelete: "set null" }),
    /** Ответы анкеты: ключи — из каталога видов заявок. */
    fields: jsonb("fields").$type<Record<string, string | string[] | boolean>>().notNull().default({}),
    /** Почему отказали или чем закончилось — пишет сотрудник. */
    outcome: text("outcome"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    stageChangedAt: timestamp("stage_changed_at", { withTimezone: true }).notNull().defaultNow(),
    closedAt: timestamp("closed_at", { withTimezone: true }),
  },
  (t) => [
    index("applications_stage_created_idx").on(t.stage, t.createdAt),
    index("applications_kind_stage_idx").on(t.kind, t.stage),
    index("applications_request_idx").on(t.requestId),
    index("applications_contact_idx").on(t.contactId),
  ],
)

/** История заявки: создание, смена этапа, назначение, правки, заметки. */
export const applicationEvents = pgTable(
  "application_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    applicationId: uuid("application_id")
      .notNull()
      .references(() => applications.id, { onDelete: "cascade" }),
    type: text("type", { enum: ["created", "stage", "assigned", "updated", "note"] }).notNull(),
    fromStage: text("from_stage"),
    toStage: text("to_stage"),
    text: text("text"),
    authorType: text("author_type", { enum: ["agent", "ai", "system", "contact"] }).notNull().default("system"),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("application_events_app_idx").on(t.applicationId, t.createdAt), index("application_events_created_idx").on(t.createdAt)],
)

/** Настройки площадки: название фонда, ИИ-агент и т. п. */
export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
})

export type User = typeof users.$inferSelect
export type Channel = typeof channels.$inferSelect
export type Contact = typeof contacts.$inferSelect
export type ContactIdentity = typeof contactIdentities.$inferSelect
export type RequestRow = typeof requests.$inferSelect
export type Message = typeof messages.$inferSelect
export type Application = typeof applications.$inferSelect
export type ApplicationEvent = typeof applicationEvents.$inferSelect
