import type { Message } from "@/db/schema"

/** Кусок цитаты для показа: одна строка, не длиннее limit. */
export function quoteExcerpt(text: string, limit = 160) {
  const line = text.replace(/\s+/g, " ").trim()
  return line.length > limit ? `${line.slice(0, limit - 1)}…` : line
}

/** Что показать в цитате, если у сообщения нет текста (только файлы). */
export function quoteLabel(message: Pick<Message, "text" | "attachments">) {
  if (message.text.trim()) return quoteExcerpt(message.text)
  const n = message.attachments.length
  return n ? (n === 1 ? `Файл: ${message.attachments[0].name}` : `Файлов: ${n}`) : "Сообщение"
}

/**
 * Для площадок без родных ответов: цитата перед текстом, как в обычной переписке.
 * Почте — классическая цитата «>».
 */
export function withQuote(text: string, replyTo: Message | null | undefined, style: "plain" | "mail" = "plain") {
  if (!replyTo) return text
  if (style === "mail") {
    const quoted = replyTo.text.trim().split("\n").map((l) => `> ${l}`).join("\n") || `> ${quoteLabel(replyTo)}`
    return `${text}\n\n${quoted}`
  }
  return `«${quoteLabel(replyTo)}»\n\n${text}`
}

/** id сообщения Telegram/ВК из нашего externalId «чат:номер». */
export function trailingId(externalId: string | null | undefined) {
  const m = externalId?.match(/:(\d+)$/)
  return m ? Number(m[1]) : null
}
