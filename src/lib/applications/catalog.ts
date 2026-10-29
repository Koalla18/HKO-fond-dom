/**
 * Виды заявок фонда «ДОМ». Файл без серверных зависимостей — его читают
 * публичные анкеты, кабинет и сервер (проверка ответов).
 *
 * У всех видов одни и те же этапы (новая → рассмотрение → в работе → итог),
 * но называются они по-разному: у «Взять питомца» итог — «Нашёл дом»,
 * у «Нашли животное» — «Помогли». Так доска и цифры обзора считаются одинаково.
 */

import type { ApplicationStage } from "@/db/schema"

export type ApplicationKind = "found" | "adopt" | "guardianship" | "foster" | "volunteer" | "supplies" | "sterilization"

export type ApplicationFieldValue = string | string[] | boolean

export type ApplicationField = {
  key: string
  label: string
  type: "text" | "textarea" | "select" | "chips" | "boolean"
  required?: boolean
  options?: string[]
  placeholder?: string
  help?: string
  /** Поле занимает всю ширину формы. */
  wide?: boolean
}

export type ApplicationKindMeta = {
  kind: ApplicationKind
  title: string
  /** Короткое название для доски и фильтров. */
  short: string
  /** Для публичной анкеты: что это за заявка и что будет дальше. */
  description: string
  next: string
  /** Ключ значка (см. components/applications/kind-icon). */
  icon: "paw" | "home" | "heart" | "sofa" | "hand" | "package" | "stethoscope"
  color: string
  /** Категория обращения во входящих, которой соответствует заявка. */
  category: string
  stages: Record<ApplicationStage, string>
  fields: ApplicationField[]
  /** Заголовок карточки по ответам анкеты. */
  makeTitle: (fields: Record<string, ApplicationFieldValue>) => string
  /** Нужна ли помощь срочно — такие заявки поднимаются наверх и видны на обзоре. */
  urgent?: (fields: Record<string, ApplicationFieldValue>) => boolean
}

export const REGION_OPTIONS = ["Москва", "Долгопрудный", "Московская область", "Другой город"]
const SPECIES = ["Собака", "Кошка", "Щенки или котята", "Другое"]

const str = (v: ApplicationFieldValue | undefined) => (typeof v === "string" ? v.trim() : Array.isArray(v) ? v.join(", ") : "")
const clip = (s: string, n = 60) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)

/** Кличка или ссылка на анкету животного → «Барс» / «анкета №1043». */
export function animalLabel(value: string) {
  const v = value.trim()
  const m = /\/animal\/([^/?#\s]+)/.exec(v)
  if (m) return /^\d+$/.test(m[1]) ? `анкета №${m[1]}` : `анкета «${decodeURIComponent(m[1])}»`
  return clip(v, 40)
}

export const APPLICATION_KINDS: Record<ApplicationKind, ApplicationKindMeta> = {
  found: {
    kind: "found",
    title: "Нашли животное",
    short: "Нашли животное",
    description: "Животное на улице, в подъезде, сбито машиной или котята остались без мамы.",
    next: "Дежурный фонда свяжется с вами. Если животное ранено — звоните, не дожидаясь ответа.",
    icon: "paw",
    color: "#ef4444",
    category: "Нашли животное",
    stages: { new: "Новая", review: "Уточняем", in_progress: "Помогаем", done: "Помогли", declined: "Не можем помочь" },
    fields: [
      { key: "species", label: "Кого нашли", type: "select", required: true, options: SPECIES },
      {
        key: "condition",
        label: "Состояние",
        type: "chips",
        required: true,
        options: ["Здоров на вид", "Ранен или хромает", "Истощён", "Без мамы", "Агрессивен или напуган"],
      },
      { key: "address", label: "Где находится", type: "text", required: true, wide: true, placeholder: "Город, улица, ориентир" },
      {
        key: "canHold",
        label: "Можете ли подержать у себя",
        type: "select",
        options: ["Да, пару дней", "Только присмотреть на месте", "Нет"],
      },
      { key: "story", label: "Что случилось", type: "textarea", wide: true, placeholder: "Когда заметили, есть ли ошейник, ведёт ли себя спокойно" },
    ],
    makeTitle: (f) => {
      const where = str(f.address)
      return [str(f.species) || "Животное", where ? `— ${clip(where, 40)}` : ""].join(" ").trim()
    },
    urgent: (f) => {
      const c = Array.isArray(f.condition) ? f.condition : [str(f.condition)]
      return c.some((x) => /ранен|хрома|без мамы|истощ/i.test(x))
    },
  },
  adopt: {
    kind: "adopt",
    title: "Взять питомца",
    short: "Взять питомца",
    description: "Хотите забрать домой собаку или кошку из фонда.",
    next: "Куратор животного позвонит, расскажет о характере и договорится о знакомстве.",
    icon: "home",
    color: "#0a7d9e",
    category: "Хочу взять питомца",
    stages: { new: "Новая анкета", review: "Собеседование", in_progress: "Знакомство", done: "Нашёл дом", declined: "Отказ" },
    fields: [
      { key: "animal", label: "Кого хотите взять", type: "text", wide: true, placeholder: "Кличка или ссылка на анкету с сайта" },
      { key: "species", label: "Если ещё не выбрали", type: "select", options: ["Собаку", "Кошку", "Пока не знаю"] },
      { key: "region", label: "Где живёте", type: "select", required: true, options: REGION_OPTIONS },
      { key: "housing", label: "Жильё", type: "select", required: true, options: ["Квартира", "Частный дом", "Снимаю жильё", "Другое"] },
      { key: "family", label: "Кто живёт с вами", type: "text", wide: true, placeholder: "Взрослые, дети, другие животные" },
      { key: "experience", label: "Был ли опыт с животными", type: "textarea", wide: true },
      { key: "agreement", label: "Готов(а) подписать договор и показывать, как живёт питомец", type: "boolean", wide: true },
    ],
    makeTitle: (f) => (str(f.animal) ? `Хочет взять ${animalLabel(str(f.animal))}` : `Хочет взять ${str(f.species).toLowerCase() || "питомца"}`),
  },
  guardianship: {
    kind: "guardianship",
    title: "Опека",
    short: "Опека",
    description: "Помогать конкретному подопечному: регулярный платёж, корма или лечение.",
    next: "Мы пришлём реквизиты и будем рассказывать, как живёт ваш подопечный.",
    icon: "heart",
    color: "#a185d8",
    category: "Опека",
    stages: { new: "Новая", review: "Подбор подопечного", in_progress: "Оформление", done: "Опекун", declined: "Отказ" },
    fields: [
      { key: "animal", label: "Подопечный", type: "text", wide: true, placeholder: "Кличка или ссылка; если не выбрали — подберём" },
      {
        key: "format",
        label: "Как хотите помогать",
        type: "select",
        required: true,
        options: ["Ежемесячный платёж", "Корма и лекарства", "Оплата лечения", "Пока не решил(а)"],
      },
      { key: "amount", label: "Сумма в месяц, если знаете", type: "text", placeholder: "Например, 1 500 ₽" },
      { key: "comment", label: "Комментарий", type: "textarea", wide: true },
    ],
    makeTitle: (f) => (str(f.animal) ? `Опека: ${animalLabel(str(f.animal))}` : `Опека: ${str(f.format).toLowerCase() || "подбор подопечного"}`),
  },
  foster: {
    kind: "foster",
    title: "Передержка",
    short: "Передержка",
    description: "Готовы временно взять животное к себе, пока ему ищут постоянный дом.",
    next: "Координатор передержек позвонит и расскажет, кому нужна помощь сейчас.",
    icon: "sofa",
    color: "#f59e0b",
    category: "Передержка",
    stages: { new: "Новая", review: "Собеседование", in_progress: "Животное у вас", done: "Завершена", declined: "Отказ" },
    fields: [
      { key: "region", label: "Где живёте", type: "select", required: true, options: REGION_OPTIONS },
      { key: "species", label: "Кого готовы взять", type: "chips", required: true, options: ["Собак", "Кошек", "Щенков или котят"] },
      { key: "period", label: "На какой срок", type: "select", required: true, options: ["До 2 недель", "До месяца", "Дольше месяца"] },
      { key: "conditions", label: "Условия", type: "textarea", wide: true, placeholder: "Квартира или дом, есть ли свои животные, дети" },
    ],
    makeTitle: (f) => `Передержка: ${str(f.species).toLowerCase() || "животных"}${str(f.period) ? `, ${str(f.period).toLowerCase()}` : ""}`,
  },
  volunteer: {
    kind: "volunteer",
    title: "Стать волонтёром",
    short: "Волонтёр",
    description: "Выгул собак, поездки с животными, фото, ярмарки, «Читаем вместе с собакой».",
    next: "Координатор волонтёров пригласит на знакомство и расскажет, с чего начать.",
    icon: "hand",
    color: "#10b981",
    category: "Волонтёрство",
    stages: { new: "Новая", review: "Знакомство", in_progress: "Пробный выход", done: "В команде", declined: "Отказ" },
    fields: [
      {
        key: "directions",
        label: "Чем хотите помогать",
        type: "chips",
        required: true,
        wide: true,
        options: [
          "Выгул собак",
          "Автоволонтёр",
          "Фото и видео",
          "Ярмарки и мероприятия",
          "«Читаем вместе с собакой»",
          "Ремонт и стройка",
          "Помощь онлайн",
        ],
      },
      { key: "region", label: "Где живёте", type: "select", options: REGION_OPTIONS },
      { key: "availability", label: "Когда удобно", type: "text", placeholder: "Выходные, вечера будней" },
      { key: "car", label: "Есть машина", type: "boolean" },
      { key: "about", label: "Пара слов о себе", type: "textarea", wide: true },
    ],
    makeTitle: (f) => {
      const d = Array.isArray(f.directions) ? f.directions : [str(f.directions)]
      return `Волонтёр: ${clip(d.filter(Boolean).join(", ").toLowerCase() || "направление не выбрано", 50)}`
    },
  },
  supplies: {
    kind: "supplies",
    title: "Помочь кормами и вещами",
    short: "Корма и вещи",
    description: "Корм, лекарства, пелёнки, лежанки, переноски — всё, что пригодится подопечным.",
    next: "Скажем, что нужно сейчас больше всего, и договоримся, как передать.",
    icon: "package",
    color: "#06b6d4",
    category: "Помощь кормами",
    stages: { new: "Новая", review: "Уточняем", in_progress: "Ждём передачу", done: "Получено", declined: "Отмена" },
    fields: [
      {
        key: "items",
        label: "Что хотите передать",
        type: "chips",
        required: true,
        wide: true,
        options: ["Сухой корм", "Влажный корм", "Лекарства", "Пелёнки", "Лежанки и переноски", "Другое"],
      },
      { key: "amount", label: "Сколько примерно", type: "text", placeholder: "Например, 2 мешка по 15 кг" },
      { key: "delivery", label: "Как передадите", type: "select", required: true, options: ["Привезу сам(а)", "Нужен забор", "Отправлю доставкой"] },
      { key: "address", label: "Адрес для забора", type: "text", wide: true, help: "Если нужен забор" },
    ],
    makeTitle: (f) => {
      const items = Array.isArray(f.items) ? f.items : [str(f.items)]
      return `Передать: ${clip(items.filter(Boolean).join(", ").toLowerCase() || "вещи", 50)}`
    },
  },
  sterilization: {
    kind: "sterilization",
    title: "Стерилизация",
    short: "Стерилизация",
    description: "Программа стерилизации для домашних и уличных животных.",
    next: "Подскажем клинику-партнёра и запишем на удобное время.",
    icon: "stethoscope",
    color: "#64748b",
    category: "Стерилизация",
    stages: { new: "Новая", review: "Запись", in_progress: "Операция", done: "Сделано", declined: "Отказ" },
    fields: [
      { key: "species", label: "Кого", type: "select", required: true, options: ["Кошку", "Собаку", "Несколько животных"] },
      { key: "count", label: "Сколько животных", type: "text", placeholder: "1" },
      {
        key: "status",
        label: "Чьё животное",
        type: "select",
        required: true,
        options: ["Домашнее", "Уличное, есть куратор", "Уличное, без куратора"],
      },
      { key: "region", label: "Где", type: "select", required: true, options: REGION_OPTIONS },
      { key: "comment", label: "Комментарий", type: "textarea", wide: true },
    ],
    makeTitle: (f) => `Стерилизация: ${str(f.species).toLowerCase() || "животное"}${str(f.count) && str(f.count) !== "1" ? ` × ${str(f.count)}` : ""}`,
  },
}

export const APPLICATION_KIND_ORDER: ApplicationKind[] = ["found", "adopt", "guardianship", "foster", "volunteer", "supplies", "sterilization"]

export const STAGE_ORDER: ApplicationStage[] = ["new", "review", "in_progress", "done", "declined"]

/** Общие названия этапов — для доски «Все виды» и обзора. */
export const STAGE_LABELS: Record<ApplicationStage, string> = {
  new: "Новые",
  review: "На рассмотрении",
  in_progress: "В работе",
  done: "Итог",
  declined: "Отказ",
}

export const STAGE_TONES: Record<ApplicationStage, string> = {
  new: "#05c7f2",
  review: "#a185d8",
  in_progress: "#f59e0b",
  done: "#10b981",
  declined: "#94a3b8",
}

export function isApplicationKind(value: unknown): value is ApplicationKind {
  return typeof value === "string" && value in APPLICATION_KINDS
}

export function stageLabel(kind: string, stage: ApplicationStage) {
  return isApplicationKind(kind) ? APPLICATION_KINDS[kind].stages[stage] : STAGE_LABELS[stage]
}

export const isClosedStage = (stage: ApplicationStage) => stage === "done" || stage === "declined"

/** Подпись значения поля для карточки и выгрузки. */
export function fieldText(value: ApplicationFieldValue | undefined) {
  if (value === undefined || value === "") return ""
  if (typeof value === "boolean") return value ? "Да" : "Нет"
  return Array.isArray(value) ? value.join(", ") : value
}

export type ValidatedFields = { fields: Record<string, ApplicationFieldValue>; errors: Record<string, string> }

/**
 * Привести ответы анкеты к виду каталога: лишние ключи отбрасываются,
 * варианты выбора проверяются, обязательные поля — по флагу strict
 * (публичная анкета — строго, сотрудник может завести черновик).
 */
export function validateFields(kind: ApplicationKind, input: Record<string, unknown>, strict: boolean): ValidatedFields {
  const fields: Record<string, ApplicationFieldValue> = {}
  const errors: Record<string, string> = {}
  for (const def of APPLICATION_KINDS[kind].fields) {
    const raw = input[def.key]
    if (def.type === "boolean") {
      if (raw === true || raw === "true" || raw === "on" || raw === "1") fields[def.key] = true
      else if (raw === false || raw === "false") fields[def.key] = false
      continue
    }
    if (def.type === "chips") {
      const list = (Array.isArray(raw) ? raw : typeof raw === "string" && raw ? raw.split(/\s*[,;]\s*/) : [])
        .map((x) => String(x).trim())
        .filter((x) => x && def.options?.includes(x))
      if (list.length) fields[def.key] = [...new Set(list)]
      else if (strict && def.required) errors[def.key] = "Выберите хотя бы один вариант"
      continue
    }
    const value = typeof raw === "string" ? raw.trim().slice(0, def.type === "textarea" ? 4000 : 400) : ""
    if (def.type === "select" && value && def.options && !def.options.includes(value)) {
      errors[def.key] = "Выберите вариант из списка"
      continue
    }
    if (value) fields[def.key] = value
    else if (strict && def.required) errors[def.key] = "Заполните поле"
  }
  return { fields, errors }
}

export function applicationTitle(kind: ApplicationKind, fields: Record<string, ApplicationFieldValue>) {
  const title = APPLICATION_KINDS[kind].makeTitle(fields).trim()
  return title || APPLICATION_KINDS[kind].title
}

export function isUrgent(kind: ApplicationKind, fields: Record<string, ApplicationFieldValue>) {
  return APPLICATION_KINDS[kind].urgent?.(fields) ?? false
}

/** Категория обращения → вид заявки (для форм сайта и разбора ИИ). */
export function kindForCategory(category: string | null | undefined): ApplicationKind | null {
  if (!category) return null
  const c = category.toLowerCase()
  if (c.includes("нашли") || c.includes("срочная ветпомощь")) return "found"
  if (c.includes("взять питомца")) return "adopt"
  if (c.includes("опек")) return "guardianship"
  if (c.includes("передерж")) return "foster"
  if (c.includes("волонт")) return "volunteer"
  if (c.includes("корм")) return "supplies"
  if (c.includes("стерилиз")) return "sterilization"
  return null
}
