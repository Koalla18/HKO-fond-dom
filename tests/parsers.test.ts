import { createHmac } from "node:crypto"
import { simpleParser } from "mailparser"
import { describe, expect, it } from "vitest"
import { mailToIncoming, stripQuotedReply } from "@/lib/channels/adapters/email"
import { maxToIncoming } from "@/lib/channels/adapters/max"
import { metaVerification, verifyMetaSignature } from "@/lib/channels/adapters/meta"
import { telegramToIncoming } from "@/lib/channels/adapters/telegram"
import { waToIncoming } from "@/lib/channels/adapters/whatsapp"
import { chunkText } from "@/lib/channels/http"
import { normalizeEmail, normalizePhone, previewOf } from "@/lib/channels/ingest"

describe("почта", () => {
  it("отрезает цитату Gmail/Яндекса и строку-вводную", () => {
    expect(stripQuotedReply("Спасибо!\n\nпн, 12 окт. 2026 г. в 10:15, Фонд <help@fond.ru>:\n> Здравствуйте")).toBe("Спасибо!")
    expect(stripQuotedReply("Ок, жду.\n\nOn Mon, Oct 12, 2026 at 10:15 AM Fund <help@fond.ru> wrote:\n> Hi")).toBe("Ок, жду.")
    expect(stripQuotedReply("Да\n\nВ письме от фонда:\n> текст")).toBe("Да")
    expect(stripQuotedReply("Да\n\n-----Original Message-----\nFrom: x")).toBe("Да")
  })
  it("не режет обычный текст со временем и двоеточием", () => {
    const text = "Приеду в 10:30, адрес:\nул. Садовая, 12"
    expect(stripQuotedReply(text)).toBe(text)
  })
  it("разбирает письмо: отправитель, тема, ключи переписки, автоответы пропускает", async () => {
    const raw = [
      "From: Мария <maria@example.org>",
      "To: help@fond.ru",
      "Subject: Помощь",
      "Message-ID: <a1@example.org>",
      "In-Reply-To: <out1@fond.ru>",
      "Content-Type: text/plain; charset=utf-8",
      "",
      "Здравствуйте!",
    ].join("\r\n")
    const incoming = await mailToIncoming(await simpleParser(raw), "uid:1", "help@fond.ru")
    expect(incoming).toMatchObject({ externalUserId: "maria@example.org", name: "Мария", subject: "Помощь", text: "Здравствуйте!", externalMessageId: "<a1@example.org>" })
    expect(incoming?.threadKeys).toContain("<out1@fond.ru>")

    const auto = await simpleParser(raw.replace("Subject: Помощь", "Subject: Помощь\r\nAuto-Submitted: auto-replied"))
    expect(await mailToIncoming(auto, "uid:2", "help@fond.ru")).toBeNull()
    const own = await simpleParser(raw.replace("Мария <maria@example.org>", "Фонд <help@fond.ru>"))
    expect(await mailToIncoming(own, "uid:3", "help@fond.ru")).toBeNull()
  })
})

describe("мессенджеры", () => {
  it("Telegram: личное сообщение, имя, ник, телефон из контакта", async () => {
    const incoming = await telegramToIncoming("t", {
      message_id: 5,
      date: 1_800_000_000,
      chat: { id: 42, type: "private" },
      from: { id: 42, first_name: "Анна", last_name: "К.", username: "anna_k" },
      text: "Привет",
      contact: { phone_number: "+79990001122" },
    })
    expect(incoming).toMatchObject({ externalUserId: "42", replyTo: "42", name: "Анна К.", handle: "anna_k", phone: "+79990001122", externalMessageId: "42:5" })
    expect(incoming?.text).toContain("Поделился телефоном")
  })
  it("Telegram: сообщения от ботов не принимаются", async () => {
    expect(await telegramToIncoming("t", { message_id: 1, date: 1, chat: { id: 1, type: "private" }, from: { id: 1, is_bot: true }, text: "x" })).toBeNull()
  })
  it("MAX: ответ в тот же диалог", async () => {
    const incoming = await maxToIncoming({
      sender: { user_id: 7, first_name: "Сергей", username: "serg" },
      recipient: { chat_id: 99, chat_type: "dialog" },
      timestamp: 1_800_000_000_000,
      body: { mid: "mid.1", text: "Добрый день" },
    })
    expect(incoming).toMatchObject({ externalUserId: "7", replyTo: "chat:99", name: "Сергей", externalMessageId: "mid.1", text: "Добрый день" })
  })
  it("WhatsApp: номер, имя из профиля, геолокация", async () => {
    const incoming = await waToIncoming(
      { contacts: [{ wa_id: "79990001122", profile: { name: "Олег" } }] },
      { from: "79990001122", id: "wamid.1", timestamp: "1800000000", type: "location", location: { latitude: 55.7, longitude: 37.6 } },
      "token",
    )
    expect(incoming).toMatchObject({ name: "Олег", phone: "+79990001122", replyTo: "79990001122" })
    expect(incoming.text).toContain("yandex.ru/maps")
  })
})

describe("вебхуки Meta", () => {
  it("проверяет подпись X-Hub-Signature-256", () => {
    const body = '{"object":"instagram"}'
    const sig = `sha256=${createHmac("sha256", "secret").update(body).digest("hex")}`
    expect(verifyMetaSignature(body, sig, "secret")).toBe(true)
    expect(verifyMetaSignature(body, sig, "other")).toBe(false)
    expect(verifyMetaSignature(body, null, "secret")).toBe(false)
  })
  it("отвечает на проверку подписки только с верным токеном", async () => {
    const ok = metaVerification(new Request("https://x/api?hub.mode=subscribe&hub.verify_token=abc&hub.challenge=123"), { verifyToken: "abc" })
    expect(await ok?.text()).toBe("123")
    const bad = metaVerification(new Request("https://x/api?hub.mode=subscribe&hub.verify_token=zzz&hub.challenge=123"), { verifyToken: "abc" })
    expect(bad?.status).toBe(403)
  })
})

describe("общие помощники", () => {
  it("телефоны приводятся к +7…", () => {
    expect(normalizePhone("8 (915) 000-11-22")).toBe("+79150001122")
    expect(normalizePhone("915 000 11 22")).toBe("+79150001122")
    expect(normalizePhone("12")).toBeNull()
  })
  it("почта в нижнем регистре, мусор отбрасывается", () => {
    expect(normalizeEmail(" Ivan@Mail.RU ")).toBe("ivan@mail.ru")
    expect(normalizeEmail("не почта")).toBeNull()
  })
  it("превью: текст или список файлов", () => {
    expect(previewOf("  a\n\nb ")).toBe("a b")
    expect(previewOf("", [{ name: "photo.jpg" }])).toBe("📎 photo.jpg")
  })
  it("длинный ответ режется по границе, без потери текста", () => {
    const text = Array.from({ length: 50 }, (_, i) => `Абзац ${i}: ${"слово ".repeat(20)}`).join("\n")
    const parts = chunkText(text, 1000)
    expect(parts.every((p) => p.length <= 1000)).toBe(true)
    expect(parts.join(" ").replace(/\s+/g, " ")).toBe(text.replace(/\s+/g, " "))
  })
})
