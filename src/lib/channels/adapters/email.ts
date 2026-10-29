import { ImapFlow } from "imapflow"
import { simpleParser, type AddressObject, type ParsedMail } from "mailparser"
import nodemailer from "nodemailer"
import type { Attachment } from "@/db/schema"
import { readStoredFile, saveFile } from "@/lib/storage"
import { withQuote } from "../reply"
import { ChannelApiError, sleep } from "../http"
import type { AdapterContext, ChannelAdapter, ChannelConfig, ChannelSecrets, IncomingMessage, SendContext } from "../types"

const POLL_MS = 60_000

type MailCreds = {
  address: string
  fromName: string
  login: string
  password: string
  imap: { host: string; port: number; secure: boolean }
  smtp: { host: string; port: number; secure: boolean }
}

function bool(value: unknown, fallback: boolean) {
  if (typeof value === "boolean") return value
  if (value === "true") return true
  if (value === "false") return false
  return fallback
}

export function mailCreds(config: ChannelConfig, secrets: ChannelSecrets): MailCreds {
  const address = String(config.address ?? "").trim()
  if (!address) throw new ChannelApiError("Не указан адрес ящика", false)
  if (!secrets.password) throw new ChannelApiError("Не указан пароль приложения", false)
  if (!config.imapHost || !config.smtpHost) throw new ChannelApiError("Не указаны IMAP- и SMTP-серверы", false)
  return {
    address,
    fromName: String(config.fromName ?? "").trim(),
    login: String(config.login ?? "").trim() || address,
    password: secrets.password,
    imap: { host: String(config.imapHost), port: Number(config.imapPort ?? 993), secure: bool(config.imapTls, true) },
    smtp: { host: String(config.smtpHost), port: Number(config.smtpPort ?? 465), secure: bool(config.smtpTls, true) },
  }
}

function imapClient(creds: MailCreds) {
  return new ImapFlow({
    host: creds.imap.host,
    port: creds.imap.port,
    secure: creds.imap.secure,
    auth: { user: creds.login, pass: creds.password },
    logger: false,
    // Локальные тестовые серверы без сертификата; боевые почтовики проходят проверку как обычно.
    tls: { rejectUnauthorized: !/^(127\.0\.0\.1|localhost)$/.test(creds.imap.host) },
    socketTimeout: 90_000,
  })
}

function smtpTransport(creds: MailCreds) {
  return nodemailer.createTransport({
    host: creds.smtp.host,
    port: creds.smtp.port,
    secure: creds.smtp.secure,
    auth: { user: creds.login, pass: creds.password },
    tls: { rejectUnauthorized: !/^(127\.0\.0\.1|localhost)$/.test(creds.smtp.host) },
  })
}

function firstAddress(value: AddressObject | AddressObject[] | undefined) {
  const list = Array.isArray(value) ? value : value ? [value] : []
  return list.flatMap((a) => a.value)[0]
}

/** Отрезаем цитату предыдущего письма: в заявке нужен только новый текст. */
export function stripQuotedReply(text: string): string {
  const lines = text.replace(/\r\n/g, "\n").split("\n")
  const markers = [
    /^-{2,}\s*(Original Message|Исходное сообщение|Пересылаемое сообщение)/i,
    /^On .{3,200} wrote:$/i,
    // «Пн, 12 окт. 2026 г. в 10:15, Иван <ivan@mail.ru>:» и «12.10.2026, 10:15, Иван пишет:»
    /^.{0,160}\d{1,2}[:.]\d{2}.{0,200}(<[^>\s]+@[^>\s]+>|пишет|написал[а]?)\s*:\s*$/i,
    /^(From|От|Отправлено|Sent):\s/i,
  ]
  let cut = lines.findIndex((line, i) => i > 0 && markers.some((re) => re.test(line.trim())))
  // Блок «> …»: режем с него, а если перед ним строка-вводная с двоеточием — и её тоже.
  const quote = lines.findIndex((line, i) => i > 0 && line.startsWith(">"))
  if (quote > 0 && (cut < 0 || quote < cut)) {
    let intro = quote - 1
    while (intro > 0 && !lines[intro].trim()) intro--
    cut = lines[intro].trim().endsWith(":") ? intro : quote
  }
  const kept = (cut > 0 ? lines.slice(0, cut) : lines).filter((line) => !line.startsWith(">"))
  return kept.join("\n").replace(/\n{3,}/g, "\n\n").trim()
}

function htmlToText(html: string) {
  return html
    .replace(/<(br|\/p|\/div|\/li|\/tr)[^>]*>/gi, "\n")
    .replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
}

function isAutomated(mail: ParsedMail) {
  const auto = String(mail.headers.get("auto-submitted") ?? "no").toLowerCase()
  const precedence = String(mail.headers.get("precedence") ?? "").toLowerCase()
  const from = firstAddress(mail.from)?.address?.toLowerCase() ?? ""
  return auto !== "no" || ["bulk", "junk", "auto_reply", "list"].includes(precedence) || /mailer-daemon|postmaster|no-?reply/.test(from)
}

export async function mailToIncoming(mail: ParsedMail, fallbackId: string, ownAddress: string): Promise<IncomingMessage | null> {
  const from = firstAddress(mail.from)
  if (!from?.address || from.address.toLowerCase() === ownAddress.toLowerCase() || isAutomated(mail)) return null
  const body = mail.text ?? (mail.html ? htmlToText(String(mail.html)) : "")
  const attachments: Attachment[] = []
  for (const file of mail.attachments ?? []) {
    if (file.related || file.contentDisposition === "inline") continue // картинки подписи
    try {
      attachments.push(await saveFile(file.filename ?? "file", file.contentType, file.content))
    } catch {
      attachments.push({ name: file.filename ?? "file", mime: file.contentType, url: "", size: file.size })
    }
  }
  const references = Array.isArray(mail.references) ? mail.references : mail.references ? [mail.references] : []
  const threadKeys = [mail.inReplyTo, ...references].filter((v): v is string => Boolean(v))
  return {
    externalUserId: from.address.toLowerCase(),
    replyTo: from.address.toLowerCase(),
    name: from.name || undefined,
    email: from.address,
    subject: mail.subject ?? undefined,
    text: stripQuotedReply(body),
    attachments,
    externalMessageId: mail.messageId ?? fallbackId,
    threadKeys,
    receivedAt: mail.date ?? new Date(),
    meta: { messageId: mail.messageId, subject: mail.subject, references: [...references, ...(mail.messageId ? [mail.messageId] : [])] },
  }
}

async function pollOnce(ctx: AdapterContext, creds: MailCreds) {
  const client = imapClient(creds)
  await client.connect()
  try {
    const box = await client.mailboxOpen(String(ctx.config.folder ?? "INBOX"))
    const validity = String(box.uidValidity)
    const state = { uidValidity: String(ctx.config._uidValidity ?? ""), lastUid: Number(ctx.config._lastUid ?? 0) }
    if (state.uidValidity !== validity) {
      // Первый запуск (или ящик пересоздан): берём письма с момента подключения, а не весь архив.
      await ctx.saveState({ _uidValidity: validity, _lastUid: Math.max(0, Number(box.uidNext) - 1) })
      await ctx.setStatus("ok", `Принимаем новые письма на ${creds.address}`)
      return
    }
    let lastUid = state.lastUid
    for await (const msg of client.fetch(`${lastUid + 1}:*`, { uid: true, source: true }, { uid: true })) {
      if (msg.uid <= lastUid || !msg.source) continue
      const mail = await simpleParser(msg.source)
      const incoming = await mailToIncoming(mail, `uid:${validity}:${msg.uid}`, creds.address)
      if (incoming) await ctx.ingest(incoming)
      lastUid = msg.uid
      await ctx.saveState({ _lastUid: lastUid })
    }
    await ctx.setStatus("ok", `Принимаем письма на ${creds.address}`)
  } finally {
    await client.logout().catch(() => client.close())
  }
}

export async function sendMail(input: Pick<SendContext, "config" | "secrets" | "text" | "attachments" | "lastIncoming" | "replyTo"> & { to: string; subject?: string | null }) {
  const creds = mailCreds(input.config, input.secrets)
  // Ответ на конкретное письмо цепляется к нему, иначе — к последнему входящему.
  const parent = input.replyTo?.meta?.messageId ? input.replyTo : input.lastIncoming
  const inReplyTo = parent?.meta?.messageId as string | undefined
  const references = (parent?.meta?.references as string[] | undefined) ?? (inReplyTo ? [inReplyTo] : [])
  const baseSubject = input.subject?.trim() || "Ответ на ваше обращение"
  const files = []
  for (const file of input.attachments) {
    const stored = await readStoredFile(file.url.split("/").pop() ?? "")
    if (stored) files.push({ filename: stored.name, content: stored.data, contentType: stored.mime })
  }
  const info = await smtpTransport(creds).sendMail({
    from: creds.fromName ? { name: creds.fromName, address: creds.address } : creds.address,
    to: input.to,
    subject: /^re:/i.test(baseSubject) ? baseSubject : `Re: ${baseSubject}`,
    text: withQuote(input.text, input.replyTo, "mail"),
    inReplyTo,
    references,
    attachments: files,
  })
  return { externalId: info.messageId, meta: { messageId: info.messageId } }
}

export const emailAdapter: ChannelAdapter = {
  kind: "email",

  async test(ctx) {
    const creds = mailCreds(ctx.config, ctx.secrets)
    const client = imapClient(creds)
    try {
      await client.connect()
    } catch (err) {
      throw new ChannelApiError(`IMAP: ${(err as Error).message}. Проверьте сервер, порт и пароль приложения.`, false)
    } finally {
      await client.logout().catch(() => client.close())
    }
    try {
      await smtpTransport(creds).verify()
    } catch (err) {
      throw new ChannelApiError(`SMTP: ${(err as Error).message}`, false)
    }
    return `Ящик ${creds.address}: вход по IMAP и SMTP выполнен`
  },

  async run(ctx) {
    const creds = mailCreds(ctx.config, ctx.secrets)
    await ctx.setStatus("connecting", `Подключаемся к ${creds.imap.host}`)
    while (!ctx.signal.aborted) {
      await pollOnce(ctx, creds)
      await sleep(Number(ctx.config._pollMs ?? POLL_MS), ctx.signal)
    }
  },

  async send({ config, secrets, request, text, attachments, lastIncoming, replyTo }) {
    return sendMail({ config, secrets, text, attachments, lastIncoming, replyTo, to: request.replyTo, subject: request.subject })
  },
}
