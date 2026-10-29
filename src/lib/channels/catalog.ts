/**
 * Каталог источников заявок. Файл без серверных зависимостей —
 * его читают и интерфейс (формы подключения), и сервер (проверка настроек).
 */

export type ChannelKind =
  | "email"
  | "vk"
  | "telegram"
  | "max"
  | "ok"
  | "instagram"
  | "facebook"
  | "whatsapp"
  | "webform"
  | "widget"
  | "manual"

export type FieldDef = {
  key: string
  label: string
  /** Секрет хранится зашифрованным и наружу отдаётся только маской. */
  secret?: boolean
  required?: boolean
  type?: "text" | "number" | "boolean" | "select" | "textarea"
  options?: { value: string; label: string }[]
  placeholder?: string
  help?: string
  default?: string | number | boolean
}

export type ChannelMeta = {
  kind: ChannelKind
  title: string
  short: string
  /** Фирменный цвет площадки — для значков в списке заявок. */
  color: string
  description: string
  /** Как приходят сообщения: опрос с нашей стороны или вебхук площадки. */
  transport: "poll" | "webhook" | "public" | "none"
  /** Для вебхуков нужен публичный HTTPS-адрес (APP_URL). */
  needsHttps: boolean
  canReply: boolean
  /** Можно ли отправить человеку файл из платформы. */
  canSendFiles: boolean
  fields: FieldDef[]
  steps: string[]
  note?: string
}

export const CHANNELS: Record<ChannelKind, ChannelMeta> = {
  email: {
    kind: "email",
    title: "Электронная почта",
    short: "Почта",
    color: "#2563eb",
    description: "Ящик фонда: письма забираются по IMAP, ответы уходят по SMTP с того же адреса.",
    transport: "poll",
    needsHttps: false,
    canReply: true,
    canSendFiles: true,
    fields: [
      { key: "address", label: "Адрес ящика", required: true, placeholder: "info@fundhome.ru" },
      { key: "fromName", label: "Имя отправителя", placeholder: "Фонд «ДОМ»" },
      { key: "imapHost", label: "IMAP-сервер", required: true, placeholder: "imap.yandex.ru" },
      { key: "imapPort", label: "IMAP-порт", type: "number", default: 993 },
      { key: "imapTls", label: "IMAP через SSL", type: "boolean", default: true },
      { key: "smtpHost", label: "SMTP-сервер", required: true, placeholder: "smtp.yandex.ru" },
      { key: "smtpPort", label: "SMTP-порт", type: "number", default: 465 },
      { key: "smtpTls", label: "SMTP через SSL", type: "boolean", default: true },
      { key: "login", label: "Логин", placeholder: "Обычно совпадает с адресом" },
      {
        key: "password",
        label: "Пароль приложения",
        secret: true,
        required: true,
        help: "Не основной пароль ящика, а пароль приложения (Яндекс, Mail.ru, Gmail выдают его в настройках безопасности).",
      },
    ],
    steps: [
      "В настройках ящика включите доступ по IMAP.",
      "Создайте пароль приложения: Яндекс ID → Безопасность → Пароли приложений (у Mail.ru и Gmail — аналогично).",
      "Впишите адрес, серверы и пароль приложения, сохраните и включите канал.",
      "Письма проверяются раз в минуту; ответ из платформы придёт человеку обычным письмом в ту же переписку.",
    ],
  },
  vk: {
    kind: "vk",
    title: "ВКонтакте",
    short: "ВК",
    color: "#0077ff",
    description: "Сообщения сообщества фонда. Работает через Long Poll — публичный адрес не нужен.",
    transport: "poll",
    needsHttps: false,
    canReply: true,
    canSendFiles: true,
    fields: [
      { key: "groupId", label: "ID сообщества", required: true, placeholder: "123456789", help: "Число из «Управление → Работа с API» (у vk.com/fundhome_ru адрес короткий — ID видно там же или из «Управление → Работа с API»." },
      {
        key: "token",
        label: "Ключ доступа сообщества",
        secret: true,
        required: true,
        help: "Права: «Сообщения сообщества» и «Управление сообществом».",
      },
    ],
    steps: [
      "Сообщество → Управление → Сообщения: включите сообщения сообщества.",
      "Управление → Работа с API → Ключи доступа: создайте ключ с правами «Сообщения сообщества» и «Управление сообществом».",
      "Работа с API → Long Poll API: включите, версия API 5.199, в «Типах событий» отметьте «Входящее сообщение».",
      "Впишите ID сообщества и ключ, сохраните и включите канал.",
    ],
  },
  telegram: {
    kind: "telegram",
    title: "Telegram",
    short: "Telegram",
    color: "#229ed9",
    description: "Бот фонда в Telegram. Без HTTPS-адреса бот опрашивается сам; с доменом можно перейти на вебхук.",
    transport: "poll",
    needsHttps: false,
    canReply: true,
    canSendFiles: true,
    fields: [
      { key: "botToken", label: "Токен бота", secret: true, required: true, placeholder: "123456:ABC-DEF…", help: "Выдаёт @BotFather командой /newbot." },
      {
        key: "mode",
        label: "Способ получения",
        type: "select",
        default: "polling",
        options: [
          { value: "polling", label: "Опрос (работает по IP)" },
          { value: "webhook", label: "Вебхук (нужен HTTPS-домен)" },
        ],
      },
    ],
    steps: [
      "Напишите @BotFather → /newbot → задайте имя и адрес бота (например, fond_dom_bot).",
      "Скопируйте токен, вставьте сюда, сохраните и включите канал.",
      "У фонда уже есть канал t.me/fundhome_ru — бот будет отдельным адресом (например, @fundhome_help_bot), ссылку на него добавьте в описание канала и на сайт.",
    ],
  },
  max: {
    kind: "max",
    title: "MAX",
    short: "MAX",
    color: "#7b3fe4",
    description: "Бот фонда в мессенджере MAX. Сообщения забираются опросом, публичный адрес не нужен.",
    transport: "poll",
    needsHttps: false,
    canReply: true,
    canSendFiles: false,
    fields: [{ key: "token", label: "Токен бота", secret: true, required: true, help: "Выдаётся при создании бота на платформе MAX для партнёров." }],
    steps: [
      "Зарегистрируйте организацию на платформе MAX для партнёров (business.max.ru) и создайте бота.",
      "Скопируйте токен бота, вставьте сюда, сохраните и включите канал.",
    ],
    note: "MAX рекомендует вебхуки для боевой нагрузки — переключим, когда у платформы появится HTTPS-домен.",
  },
  ok: {
    kind: "ok",
    title: "Одноклассники",
    short: "ОК",
    color: "#ee8208",
    description: "Сообщения группы фонда в Одноклассниках через Graph API ботов.",
    transport: "webhook",
    needsHttps: true,
    canReply: true,
    canSendFiles: false,
    fields: [
      {
        key: "token",
        label: "Ключ доступа группы",
        secret: true,
        required: true,
        help: "Настройки группы → Сообщения → «Получить ключ доступа» (полная версия сайта, нужен администратор группы).",
      },
    ],
    steps: [
      "Откройте группу фонда на ok.ru в полной версии сайта, зайдите в Настройки → Сообщения.",
      "Включите сообщения группы и нажмите «Получить ключ доступа».",
      "Вставьте ключ сюда, сохраните и включите канал — платформа сама подпишется на сообщения группы.",
    ],
    note: "Одноклассники присылают сообщения только на HTTPS-адрес платформы — канал заработает после подключения домена.",
  },
  instagram: {
    kind: "instagram",
    title: "Instagram",
    short: "Instagram",
    color: "#e1306c",
    description: "Директ профессионального аккаунта через Meta (Instagram Messaging API).",
    transport: "webhook",
    needsHttps: true,
    canReply: true,
    canSendFiles: false,
    fields: [
      { key: "accountId", label: "ID аккаунта Instagram", required: true, help: "ID профессионального аккаунта, привязанного к странице Facebook." },
      { key: "accessToken", label: "Токен доступа страницы", secret: true, required: true },
      { key: "appSecret", label: "App Secret приложения Meta", secret: true, required: true, help: "Нужен, чтобы проверять подпись входящих событий." },
    ],
    steps: [
      "Переведите Instagram фонда в профессиональный аккаунт и привяжите к странице Facebook.",
      "Создайте приложение на developers.facebook.com (тип «Business»), добавьте продукт Instagram и Webhooks.",
      "Укажите адрес вебхука и токен проверки из блока ниже, подпишитесь на поле messages.",
      "Выпустите токен страницы с правами instagram_manage_messages и pages_messaging, впишите его и App Secret.",
      "Для боевого режима приложение проходит проверку Meta (App Review) — до неё отвечать можно только тестовым пользователям.",
    ],
    note: "Нужен публичный HTTPS-адрес платформы. Компания Meta признана в России экстремистской; использование Instagram организацией — на решение фонда.",
  },
  facebook: {
    kind: "facebook",
    title: "Facebook Messenger",
    short: "Facebook",
    color: "#0866ff",
    description: "Сообщения страницы фонда в Facebook.",
    transport: "webhook",
    needsHttps: true,
    canReply: true,
    canSendFiles: false,
    fields: [
      { key: "pageId", label: "ID страницы", required: true },
      { key: "accessToken", label: "Токен доступа страницы", secret: true, required: true },
      { key: "appSecret", label: "App Secret приложения Meta", secret: true, required: true },
    ],
    steps: [
      "В приложении Meta добавьте продукты Messenger и Webhooks.",
      "Укажите адрес вебхука и токен проверки из блока ниже, подпишите страницу на поле messages.",
      "Выпустите токен страницы с правом pages_messaging и впишите его и App Secret.",
    ],
    note: "Нужен публичный HTTPS-адрес платформы.",
  },
  whatsapp: {
    kind: "whatsapp",
    title: "WhatsApp",
    short: "WhatsApp",
    color: "#25d366",
    description: "Номер фонда в WhatsApp Business Cloud API.",
    transport: "webhook",
    needsHttps: true,
    canReply: true,
    canSendFiles: false,
    fields: [
      { key: "phoneNumberId", label: "Phone number ID", required: true },
      { key: "accessToken", label: "Постоянный токен", secret: true, required: true },
      { key: "appSecret", label: "App Secret приложения Meta", secret: true, required: true },
    ],
    steps: [
      "В приложении Meta добавьте продукт WhatsApp и подключите номер фонда.",
      "Создайте системного пользователя в Business Manager и выпустите постоянный токен с правом whatsapp_business_messaging.",
      "Укажите адрес вебхука и токен проверки из блока ниже, подпишитесь на поле messages.",
    ],
    note: "Отвечать свободным текстом можно 24 часа после последнего сообщения человека; позже — только шаблонами Meta.",
  },
  webform: {
    kind: "webform",
    title: "Форма на сайте",
    short: "Форма",
    color: "#0f766e",
    description: "Формы сайта фонда («Обратная связь», «Взять под опеку»). Ответ уходит на почту, указанную в форме.",
    transport: "public",
    needsHttps: false,
    canReply: true,
    canSendFiles: true,
    fields: [
      {
        key: "replyChannelId",
        label: "Через какой ящик отвечать",
        type: "select",
        help: "Ответ на заявку с формы уйдёт письмом на адрес, который человек указал.",
      },
      { key: "successMessage", label: "Текст после отправки", default: "Спасибо! Мы получили заявку и скоро свяжемся с вами." },
    ],
    steps: [
      "Сохраните канал — ниже появится адрес приёма и пример формы.",
      "Формы fundhome.ru можно не переделывать: адрес приёма понимает их поля form[name], form[phone], form[email], form[theme], form[text], form[animal], form[type].",
      "Достаточно, чтобы сайт дополнительно отправлял форму на адрес приёма (или переключить action формы на него).",
    ],
  },
  widget: {
    kind: "widget",
    title: "Чат на сайте",
    short: "Сайт",
    color: "#0a7d9e",
    description: "Кнопка чата в углу сайта фонда. Посетитель пишет — сообщение сразу появляется здесь.",
    transport: "public",
    needsHttps: false,
    canReply: true,
    canSendFiles: true,
    fields: [
      { key: "greeting", label: "Приветствие", default: "Здравствуйте! Это фонд «ДОМ». Нашли животное, хотите помочь или взять питомца? Напишите — мы ответим." },
      { key: "accent", label: "Цвет кнопки", default: "#0a7d9e" },
    ],
    steps: ["Сохраните канал — ниже появится строка кода.", "Вставьте её перед </body> на всех страницах сайта."],
  },
  manual: {
    kind: "manual",
    title: "Телефон и личный приём",
    short: "Звонок",
    color: "#64748b",
    description: "Заявки, которые сотрудник заводит вручную: звонок, визит, письмо по почте России.",
    transport: "none",
    needsHttps: false,
    canReply: false,
    canSendFiles: false,
    fields: [],
    steps: ["Создайте канал один раз — обращения из звонков заводятся кнопкой «Обращение» во входящих; если человеку нужна помощь фонда — оформите заявку в его карточке."],
  },
}

export const CHANNEL_ORDER: ChannelKind[] = [
  "email",
  "vk",
  "telegram",
  "max",
  "ok",
  "widget",
  "webform",
  "whatsapp",
  "instagram",
  "facebook",
  "manual",
]

export function isChannelKind(value: string): value is ChannelKind {
  return value in CHANNELS
}

export const STATUS_LABELS = {
  new: "Новое",
  open: "В работе",
  waiting: "Ждём ответа",
  resolved: "Решено",
  spam: "Спам",
} as const

export const PRIORITY_LABELS = {
  low: "Низкий",
  normal: "Обычный",
  high: "Высокий",
  urgent: "Срочно",
} as const

/**
 * Категории заявок под направления фонда «ДОМ» (fundhome.ru): помощь кормами,
 * ветеринарная помощь, стерилизация, передержка и опека, «Шерстяная помощь»,
 * «Читаем вместе с собакой», строительство убежищ.
 */
export const DEFAULT_CATEGORIES = [
  "Нашли животное",
  "Срочная ветпомощь",
  "Хочу взять питомца",
  "Передержка",
  "Опека",
  "Помощь кормами",
  "Стерилизация",
  "Волонтёрство",
  "Пожертвование",
  "«Шерстяная помощь»",
  "«Читаем вместе с собакой»",
  "Партнёрство",
  "СМИ",
  "Другое",
]
