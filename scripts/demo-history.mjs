// Демо-история для ЛОКАЛЬНОЙ базы: год обращений и заявок фонда «ДОМ», чтобы обзор и доска
// выглядели как в работе. Стирает обращения, людей и заявки (каналы, сотрудники и настройки остаются).
// Запуск: node --env-file=.env.local scripts/demo-history.mjs --reset
// Каналы должны уже быть (scripts/demo.mjs), миграции применены (сервер запускался хотя бы раз).
import pg from "pg"
import { randomBytes, randomUUID } from "node:crypto"

if (!process.argv.includes("--reset")) {
  console.error("Скрипт стирает обращения и заявки. Запустите с флагом --reset.")
  process.exit(1)
}
if (/prod|timeweb|\.ru\//i.test(process.env.DATABASE_URL ?? "")) {
  console.error("Похоже на рабочую базу — демо-историю туда не пишем.")
  process.exit(1)
}

const db = new pg.Client({ connectionString: process.env.DATABASE_URL })
await db.connect()

// Детерминированный генератор: одна и та же история при каждом запуске.
let seed = 20261029
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648)
const pick = (list) => list[Math.floor(rnd() * list.length)]
const chance = (p) => rnd() < p
const between = (a, b) => a + rnd() * (b - a)

const HOUR = 3600_000
const DAY = 24 * HOUR
const now = Date.now()

const channels = Object.fromEntries((await db.query("select id, kind from channels")).rows.map((c) => [c.kind, c.id]))
for (const kind of ["vk", "telegram", "webform", "widget", "email", "ok", "max", "manual"]) {
  if (!channels[kind]) throw new Error(`Нет канала ${kind} — сначала scripts/demo.mjs`)
}

// Сотрудники фонда для демо: войти под ними нельзя (случайный пароль).
const STAFF = [
  ["Мария Котова", "maria@demo.dom.local"],
  ["Алексей Дорохов", "alexey@demo.dom.local"],
  ["Ирина Белова", "irina@demo.dom.local"],
]
const staff = []
for (const [name, email] of STAFF) {
  const hash = `disabled$${randomBytes(16).toString("hex")}`
  const { rows } = await db.query(
    `insert into users (email, name, role, password_hash) values ($1, $2, 'agent', $3)
     on conflict (email) do update set name = excluded.name returning id, name`,
    [email, name, hash],
  )
  staff.push(rows[0])
}
const admin = (await db.query("select id, name from users where role = 'admin' order by created_at limit 1")).rows[0]
const team = [admin, ...staff]

await db.query("truncate application_events, applications, messages, contact_identities, requests, contacts restart identity cascade")

const FIRST = ["Анна", "Ольга", "Елена", "Мария", "Наталья", "Ирина", "Татьяна", "Светлана", "Юлия", "Ксения", "Дарья", "Алина", "Сергей", "Андрей", "Дмитрий", "Алексей", "Михаил", "Игорь", "Павел", "Никита", "Артём", "Владимир"]
const LAST_F = ["Смирнова", "Кузнецова", "Попова", "Волкова", "Соколова", "Лебедева", "Козлова", "Новикова", "Морозова", "Белова", "Орлова", "Зайцева"]
const LAST_M = ["Смирнов", "Кузнецов", "Попов", "Волков", "Соколов", "Лебедев", "Козлов", "Новиков", "Морозов", "Белов", "Орлов", "Зайцев"]
const PLACES = ["Долгопрудный, Лихачёвский проспект", "Долгопрудный, Новый бульвар", "Химки, Юбилейный проспект", "Лобня, ул. Ленина", "Мытищи, Олимпийский проспект", "Москва, Дмитровское шоссе", "Москва, Бескудниково", "Долгопрудный, Шереметьевский", "Химки, Левобережный", "Москва, Лианозово"]
const ANIMALS = ["Барс", "Луна", "Тайсон", "Мася", "Рыжик", "Белка", "Граф", "Соня", "Буся", "Джек", "Плюша", "Ветер", "Зефир", "Кнопка"]

const person = () => {
  const female = chance(0.62)
  return `${pick(FIRST.slice(female ? 0 : 12, female ? 12 : 22))} ${pick(female ? LAST_F : LAST_M)}`
}

// Сценарии: категория обращения, вид заявки, тексты и ответы анкеты.
const SCENARIOS = [
  {
    w: 18, category: "Нашли животное", kind: "found",
    text: (f) => `Здравствуйте! ${f.address}: ${f.species === "Кошка" ? "кошка" : f.species === "Щенки или котята" ? "котята" : "собака"} ${f.condition.includes("Ранен или хромает") ? "хромает, похоже, сбила машина" : f.condition.includes("Без мамы") ? "сидят одни второй день, мамы нет" : "сидит у подъезда уже несколько дней"}. Можете помочь?`,
    fields: () => {
      const species = pick(["Собака", "Кошка", "Щенки или котята"])
      const condition = species === "Щенки или котята" ? ["Без мамы"] : chance(0.45) ? ["Ранен или хромает"] : chance(0.5) ? ["Истощён"] : ["Здоров на вид"]
      return { species, condition, address: pick(PLACES), canHold: pick(["Да, пару дней", "Только присмотреть на месте", "Нет"]) }
    },
  },
  {
    w: 16, category: "Хочу взять питомца", kind: "adopt",
    text: (f) => `Добрый день! Хотим взять ${f.animal}. Живём в ${f.region === "Москва" ? "Москве" : f.region === "Долгопрудный" ? "Долгопрудном" : "Подмосковье"}, ${f.housing.toLowerCase()}. Как познакомиться?`,
    fields: () => ({ animal: pick(ANIMALS), region: pick(["Москва", "Долгопрудный", "Московская область"]), housing: pick(["Квартира", "Частный дом"]), family: pick(["Двое взрослых", "Семья с ребёнком 10 лет", "Живу одна, есть кошка"]), agreement: true }),
  },
  {
    w: 9, category: "Опека", kind: "guardianship",
    text: (f) => `Хочу стать опекуном ${f.animal ? f.animal : "кого-то из подопечных"}. ${f.format}${f.amount ? `, ${f.amount}` : ""}.`,
    fields: () => ({ animal: chance(0.6) ? pick(ANIMALS) : "", format: pick(["Ежемесячный платёж", "Корма и лекарства", "Оплата лечения"]), amount: pick(["1 000 ₽", "1 500 ₽", "3 000 ₽", ""]) }),
  },
  {
    w: 7, category: "Передержка", kind: "foster",
    text: (f) => `Могу взять на передержку ${f.species.join(", ").toLowerCase()} — ${f.period.toLowerCase()}. Живу: ${f.region}.`,
    fields: () => ({ region: pick(["Долгопрудный", "Москва", "Московская область"]), species: chance(0.5) ? ["Кошек"] : ["Собак"], period: pick(["До 2 недель", "До месяца", "Дольше месяца"]), conditions: pick(["Квартира, своих животных нет", "Частный дом, есть собака-девочка"]) }),
  },
  {
    w: 9, category: "Волонтёрство", kind: "volunteer",
    text: (f) => `Хочу помогать фонду: ${f.directions.join(", ").toLowerCase()}. ${f.availability}.`,
    fields: () => ({ directions: [pick(["Выгул собак", "Автоволонтёр", "Фото и видео", "Ярмарки и мероприятия", "«Читаем вместе с собакой»"])], region: pick(["Долгопрудный", "Москва"]), availability: pick(["Свободна по выходным", "Могу вечерами в будни", "Раз в две недели"]), car: chance(0.3) }),
  },
  {
    w: 7, category: "Помощь кормами", kind: "supplies",
    text: (f) => `Хотим передать ${f.items.join(", ").toLowerCase()} — ${f.amount}. ${f.delivery}.`,
    fields: () => ({ items: [pick(["Сухой корм", "Влажный корм", "Пелёнки", "Лежанки и переноски", "Лекарства"])], amount: pick(["2 мешка по 15 кг", "коробку", "около 10 кг"]), delivery: pick(["Привезу сам(а)", "Нужен забор"]) }),
  },
  {
    w: 4, category: "Стерилизация", kind: "sterilization",
    text: (f) => `Нужна стерилизация: ${f.species.toLowerCase()}, ${f.status.toLowerCase()}. ${f.region}.`,
    fields: () => ({ species: pick(["Кошку", "Собаку"]), count: "1", status: pick(["Домашнее", "Уличное, есть куратор"]), region: pick(["Долгопрудный", "Химки", "Москва"].map((x) => (x === "Химки" ? "Московская область" : x))) }),
  },
  { w: 12, category: "Пожертвование", text: () => pick(["Подписалась на 500 ₽ в месяц, не пришло письмо. Всё прошло?", "Как перевести пожертвование от организации, нужен договор?", "Можно ли пожертвовать на лечение конкретной собаки?"]) },
  { w: 6, category: "Другое", text: () => pick(["Как к вам приехать познакомиться с собаками?", "Есть ли у вас мерч? Хочу подарить другу толстовку.", "Мы школа, хотим провести урок доброты с вашими волонтёрами."]) },
  { w: 4, category: "СМИ", text: () => "Добрый день! Готовим сюжет о бездомных животных Подмосковья, можно взять у вас комментарий?" },
]
const totalW = SCENARIOS.reduce((s, x) => s + x.w, 0)
const scenario = () => {
  let r = rnd() * totalW
  for (const s of SCENARIOS) if ((r -= s.w) < 0) return s
  return SCENARIOS[0]
}

const CHANNEL_W = [["vk", 30], ["telegram", 20], ["webform", 14], ["widget", 10], ["email", 10], ["ok", 7], ["max", 6], ["manual", 3]]
const channelKind = () => {
  let r = rnd() * 100
  for (const [k, w] of CHANNEL_W) if ((r -= w) < 0) return k
  return "vk"
}

const REPLIES = {
  found: "Спасибо, что не прошли мимо! Подскажите, пожалуйста, точный адрес и можно ли прислать фото — дежурный уже смотрит.",
  adopt: "Здравствуйте! Как здорово. Куратор позвонит сегодня-завтра и расскажет о характере, договоримся о знакомстве.",
  guardianship: "Спасибо! Пришлём реквизиты и будем рассказывать, как живёт подопечный.",
  foster: "Спасибо огромное! Координатор передержек свяжется и расскажет, кому нужна помощь сейчас.",
  volunteer: "Рады вам! Координатор волонтёров пригласит на знакомство.",
  supplies: "Спасибо! Сейчас больше всего нужен влажный корм для котят. Договоримся о передаче.",
  sterilization: "Подскажем клинику-партнёра и запишем на удобное время.",
  other: "Здравствуйте! Спасибо за обращение, сейчас ответим подробно.",
}

const TITLE = {
  found: (f) => `${f.species} — ${f.address.length > 38 ? f.address.slice(0, 37) + "…" : f.address}`,
  adopt: (f) => `Хочет взять ${f.animal}`,
  guardianship: (f) => (f.animal ? `Опека: ${f.animal}` : `Опека: ${f.format.toLowerCase()}`),
  foster: (f) => `Передержка: ${f.species.join(", ").toLowerCase()}, ${f.period.toLowerCase()}`,
  volunteer: (f) => `Волонтёр: ${f.directions.join(", ").toLowerCase()}`,
  supplies: (f) => `Передать: ${f.items.join(", ").toLowerCase()}`,
  sterilization: (f) => `Стерилизация: ${f.species.toLowerCase()}`,
}
const URGENT = (kind, f) => kind === "found" && f.condition.some((c) => /Ранен|Без мамы|Истощ/.test(c))

/** Моменты обращений: год назад редко, ближе к сегодня — чаще (фонд растёт). Москва — всегда UTC+3. */
function moments() {
  const MSK = 3 * HOUR
  const list = []
  for (let d = 400; d >= 0; d--) {
    const dayStart = Math.floor((now - d * DAY + MSK) / DAY) * DAY - MSK
    const growth = 0.35 + 0.65 * (1 - d / 400)
    const weekday = new Date(dayStart + MSK).getUTCDay()
    const n = Math.max(0, Math.round((weekday === 0 || weekday === 6 ? 3.2 : 4.6) * growth + between(-1.6, 1.8)))
    for (let i = 0; i < n; i++) {
      const t = dayStart + between(8.5, 23) * HOUR
      if (t < now - 5 * 60_000) list.push(t)
    }
  }
  return list.sort((a, b) => a - b)
}

let requests = 0
let apps = 0
for (const at of moments()) {
  const sc = scenario()
  const kind = sc.kind ?? null
  const fields = sc.fields ? sc.fields() : {}
  const name = person()
  const chKind = kind && chance(0.35) ? "webform" : channelKind()
  const ageDays = (now - at) / DAY
  const phone = chance(0.6) ? `+79${Math.floor(between(100000000, 999999999))}` : null
  const email = chKind === "email" || chKind === "webform" || chance(0.2) ? `${randomUUID().slice(0, 8)}@example.ru` : null

  const contact = (await db.query("insert into contacts (name, email, phone, created_at) values ($1,$2,$3,$4) returning id", [name, email, phone, new Date(at)])).rows[0].id
  const extId = chKind === "email" || chKind === "webform" ? email ?? phone ?? randomUUID() : `${chKind}-${randomUUID().slice(0, 8)}`
  await db.query("insert into contact_identities (contact_id, channel_id, external_id, created_at) values ($1,$2,$3,$4)", [contact, channels[chKind], extId, new Date(at)])

  const assignee = chance(0.85) ? pick(team).id : null
  // Ответ: чаще в пределах часа, ночью — к утру.
  const hourMsk = (new Date(at).getUTCHours() + 3) % 24
  const delay = hourMsk >= 22 ? between(8, 11) * HOUR : chance(0.74) ? between(4, 55) * 60_000 : between(1.2, 7) * HOUR
  const repliedAt = at + delay
  const replied = repliedAt < now - 2 * 60_000 && (ageDays > 0.4 || chance(0.6))
  const status = !replied ? (chance(0.6) ? "new" : "open") : ageDays > 4 ? (chance(0.93) ? "resolved" : "open") : pick(["open", "waiting", "resolved"])
  const text = sc.text(fields)
  const priority = kind && URGENT(kind, fields) ? "urgent" : sc.category === "СМИ" ? "high" : "normal"
  const lastAt = replied ? repliedAt : at
  const req = (
    await db.query(
      `insert into requests (channel_id, contact_id, reply_to, subject, status, priority, category, assignee_id, unread,
        last_message_at, last_message_preview, last_message_direction, created_at, resolved_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) returning id`,
      [
        channels[chKind], contact, email ?? phone ?? extId, kind ? null : sc.category, status, priority, sc.category,
        status === "new" ? null : assignee, replied ? 0 : 1, new Date(lastAt), (replied ? REPLIES[kind ?? "other"] : text).slice(0, 160),
        replied ? "out" : "in", new Date(at), status === "resolved" ? new Date(lastAt + between(1, 30) * HOUR) : null,
      ],
    )
  ).rows[0].id
  requests++
  await db.query("insert into messages (request_id, channel_id, direction, author_type, text, created_at) values ($1,$2,'in','contact',$3,$4)", [req, channels[chKind], text, new Date(at)])
  if (replied) {
    await db.query(
      "insert into messages (request_id, channel_id, direction, author_type, author_user_id, text, delivery, created_at) values ($1,$2,'out','agent',$3,$4,'sent',$5)",
      [req, channels[chKind], assignee ?? admin.id, REPLIES[kind ?? "other"], new Date(repliedAt)],
    )
  }

  if (!kind || !(chKind === "webform" || chance(0.45))) continue
  // Заявка: старые дошли до итога, свежие — в работе.
  const created = at + (chKind === "webform" ? 0 : between(10, 90) * 60_000)
  if (created > now) continue
  const doneP = kind === "adopt" ? 0.62 : kind === "volunteer" ? 0.55 : 0.7
  let stage = "new"
  const steps = []
  let tStep = created
  const longRunning = kind === "adopt" || kind === "foster" || kind === "guardianship" || kind === "volunteer"
  const plan = ageDays > 45 ? (chance(doneP + 0.15) ? ["review", "in_progress", "done"] : chance(0.75) ? ["review", "declined"] : longRunning ? ["review", "in_progress"] : ["review", "in_progress", "done"])
    : ageDays > 14 ? (chance(doneP) ? ["review", "in_progress", "done"] : chance(0.35) ? ["review", "declined"] : ["review", "in_progress"])
    : ageDays > 4 ? (chance(0.35) ? ["review", "in_progress", "done"] : chance(0.6) ? ["review", "in_progress"] : ["review"])
    : ageDays > 1 ? (chance(0.5) ? ["review"] : chance(0.5) ? ["review", "in_progress"] : [])
    : chance(0.2) ? ["review"] : []
  for (const next of plan) {
    tStep += between(kind === "found" ? 1 : 10, kind === "adopt" ? 96 : 40) * HOUR
    if (tStep > now - 60_000) break
    steps.push({ from: stage, to: next, at: tStep })
    stage = next
  }
  const closed = stage === "done" || stage === "declined"
  const lastChange = steps.length ? steps[steps.length - 1].at : created
  const outcome = stage === "done"
    ? kind === "adopt" ? `${fields.animal} уехал(а) домой, договор подписан` : kind === "found" ? "Забрали в клинику-партнёр, после лечения — на передержку" : null
    : stage === "declined" ? pick(["Не выходит на связь", "Нет условий — предложили помощь кормами", "Передумали"]) : null
  const appAssignee = stage === "new" ? null : assignee ?? pick(team).id
  const app = (
    await db.query(
      `insert into applications (kind, stage, title, urgent, contact_id, request_id, source, assignee_id, fields, outcome, created_at, updated_at, stage_changed_at, closed_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$12,$13) returning id, number`,
      [kind, stage, TITLE[kind](fields), URGENT(kind, fields) && !closed && ageDays < 5, contact, req, chance(0.75) ? "ai" : "inbox", appAssignee, fields, outcome, new Date(created), new Date(lastChange), closed ? new Date(lastChange) : null],
    )
  ).rows[0]
  apps++
  const bySelf = (await db.query("select source from applications where id = $1", [app.id])).rows[0].source === "ai"
  await db.query("insert into application_events (application_id, type, to_stage, author_type, user_id, created_at) values ($1,'created','new',$2,$3,$4)", [
    app.id, bySelf ? "ai" : "agent", bySelf ? null : (assignee ?? admin.id), new Date(created),
  ])
  for (const s of steps) {
    await db.query("insert into application_events (application_id, type, from_stage, to_stage, text, author_type, user_id, created_at) values ($1,'stage',$2,$3,$4,'agent',$5,$6)", [
      app.id, s.from, s.to, s.to === stage ? outcome : null, appAssignee ?? admin.id, new Date(s.at),
    ])
  }
}

await db.end()
console.log(`Готово: обращений ${requests}, заявок ${apps}, сотрудников ${team.length}`)
