import { normalizeEmail } from "../ingest"
import { ChannelApiError } from "../http"
import { loadChannel } from "../store"
import type { ChannelAdapter } from "../types"
import { sendMail } from "./email"

/** Форма на сайте: заявки приходят на публичный адрес, ответы — письмом через выбранный ящик. */
export const webformAdapter: ChannelAdapter = {
  kind: "webform",
  async send({ config, request, text, attachments, lastIncoming, replyTo }) {
    const to = normalizeEmail(request.replyTo)
    if (!to) throw new ChannelApiError("Человек не оставил почту — свяжитесь по телефону из карточки", false)
    const replyChannelId = String(config.replyChannelId ?? "")
    const mailbox = replyChannelId ? await loadChannel(replyChannelId) : null
    if (!mailbox || mailbox.channel.kind !== "email") {
      throw new ChannelApiError("Для формы не выбран почтовый ящик для ответов (Каналы → Форма на сайте)", false)
    }
    return sendMail({ ...mailbox, text, attachments, lastIncoming, replyTo, to, subject: request.subject ?? "Ваша заявка на сайте фонда" })
  },
}

/** Чат на сайте: ответ сохраняется в базе, виджет у посетителя забирает его сам. */
export const widgetAdapter: ChannelAdapter = {
  kind: "widget",
  async send() {
    return {}
  },
}

/** Телефон и личный приём: заявки заводит сотрудник, отвечать некуда. */
export const manualAdapter: ChannelAdapter = { kind: "manual" }
