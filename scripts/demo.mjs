// Демо-наполнение ЛОКАЛЬНОЙ базы под фонд «ДОМ»: каналы + обращения через симулятор.
// Запуск: node --env-file=.env.local scripts/demo.mjs   (платформа должна быть запущена)
const base = process.env.APP_URL ?? "http://localhost:3050"

async function call(path, init = {}, cookie) {
  const res = await fetch(base + path, {
    ...init,
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}), ...(init.headers ?? {}) },
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(`${path}: ${data.error ?? res.status}`)
  return { data, res }
}

const login = await call("/api/auth/login", { method: "POST", body: JSON.stringify({ email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD }) })
const cookie = login.res.headers.get("set-cookie").split(";")[0]

const { data: existing } = await call("/api/channels", {}, cookie)
const byKind = Object.fromEntries(existing.channels.map((c) => [c.kind, c]))

// Каналы без ключей выключены: заявки в них — только демонстрация через симулятор.
const plan = [
  { kind: "vk", name: "ВКонтакте · fundhome_ru", enabled: false },
  { kind: "telegram", name: "Telegram-бот фонда", enabled: false },
  { kind: "max", name: "MAX фонда", enabled: false },
  { kind: "ok", name: "Одноклассники · fundhome", enabled: false },
  { kind: "email", name: "Почта фонда", enabled: false, config: { address: "info@fundhome.ru", imapHost: "imap.yandex.ru", smtpHost: "smtp.yandex.ru", fromName: "Фонд «ДОМ»" } },
  { kind: "webform", name: "Формы сайта fundhome.ru", enabled: true },
  { kind: "widget", name: "Чат на сайте", enabled: true },
  { kind: "manual", name: "Телефон +7 (925) 781-77-85", enabled: true },
]
for (const ch of plan) {
  if (byKind[ch.kind]) continue
  const { data } = await call("/api/channels", { method: "POST", body: JSON.stringify({ config: {}, secrets: {}, ...ch }) }, cookie)
  byKind[ch.kind] = data.channel
}

const messages = [
  ["vk", "vk-1", "Ольга Смирнова", "Здравствуйте! У нас во дворе на Лихачёвском проспекте сбили собаку, лежит у мусорных баков, задняя лапа не работает. Можете помочь с ветеринаром? Фото пришлю."],
  ["telegram", "tg-77", "Анна", "Подписалась на 500 ₽ в месяц, но не пришло письмо с подтверждением. Всё прошло?"],
  ["max", "max-9", "Сергей Козлов", "Мы — зоомагазин в Химках, хотим ставить у кассы бокс для сбора кормов фонду. С кем обсудить?"],
  ["ok", "ok-5", "Галина Ивановна", "Нашла в подъезде трёх котят, совсем маленькие, мама не приходит второй день. Что делать?"],
  ["email", "school@example.ru", "Школа № 112", "Добрый день! Хотим провести у себя «Читаем вместе с собакой» для третьих классов. Возможно ли это в декабре?", { email: "school@example.ru", subject: "Читаем вместе с собакой" }],
  ["widget", "site-1", undefined, "Сколько стоит взять кошку под опеку и что для этого нужно?"],
  ["vk", "vk-2", "Дмитрий", "Могу взять собаку на передержку на месяц, есть опыт и частный дом в Лобне."],
]
for (const [kind, id, name, text, extra = {}] of messages) {
  await call("/api/dev/simulate", { method: "POST", body: JSON.stringify({ channelId: byKind[kind].id, externalUserId: id, name, text, ...extra }) }, cookie)
}

// Заявка с формы «Взять под опеку» — ровно теми полями, что шлёт fundhome.ru.
const form = new URLSearchParams({ "form[animal]": "/animal/1043", "form[name]": "Елена Викторовна", "form[phone]": "+7 921 000-11-22", "form[email]": "elena@example.ru", "form[type]": "Буду помогать финансами" })
await fetch(`${base}/api/public/form/${byKind.webform.id}`, { method: "POST", body: form })

console.log(`Готово: каналов ${Object.keys(byKind).length}, демо-обращений ${messages.length + 1}`)
