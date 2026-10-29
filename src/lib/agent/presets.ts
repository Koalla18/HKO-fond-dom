/**
 * Модели для ассистента. Все — через OpenAI-совместимый API (/chat/completions), поэтому
 * код один, отличаются адрес, имя модели и заголовки. Файл без серверных зависимостей.
 */
export type AiProvider = "none" | "timeweb" | "yandexgpt" | "gigachat" | "deepseek" | "openai" | "custom"

export type AiPreset = {
  id: Exclude<AiProvider, "none">
  title: string
  note: string
  baseUrl: string
  model: string
  /** Нужен ли идентификатор каталога (Yandex Cloud). */
  needsFolder?: boolean
  /** Работает из России без прокси. */
  fromRussia: boolean
  /** Данные остаются в России — телефоны и почты не скрываем. */
  dataInRussia: boolean
  /** Адрес у каждого свой (агент Timeweb) — без него не подключить. */
  needsUrl?: string
}

export const AI_PRESETS: AiPreset[] = [
  {
    id: "timeweb",
    title: "Timeweb Cloud AI",
    note: "Агент в панели Timeweb: модель выбирается там, оплата рублями, данные в России.",
    baseUrl: "",
    // Модель задана в самом агенте, поле обязательное, но Timeweb его не смотрит.
    model: "timeweb-agent",
    fromRussia: true,
    dataInRussia: true,
    needsUrl: "OpenAI URL агента: https://agent.timeweb.cloud/api/v1/cloud-ai/agents/…/v1",
  },
  {
    id: "yandexgpt",
    title: "YandexGPT",
    note: "Данные в России, оплата рублями. Нужны API-ключ и ID каталога Yandex Cloud.",
    baseUrl: "https://llm.api.cloud.yandex.net/v1",
    model: "gpt://{folder}/yandexgpt/latest",
    needsFolder: true,
    fromRussia: true,
    dataInRussia: true,
  },
  {
    id: "gigachat",
    title: "GigaChat (cloud.ru)",
    note: "Данные в России. Ключ — в Cloud.ru → Foundation Models.",
    baseUrl: "https://foundation-models.api.cloud.ru/v1",
    model: "ai-sage/GigaChat3-10B-A1.8B",
    fromRussia: true,
    dataInRussia: true,
  },
  {
    id: "deepseek",
    title: "DeepSeek",
    note: "Недорого, отвечает из России. Данные уходят за рубеж — имена и телефоны ассистенту не нужны.",
    baseUrl: "https://api.deepseek.com/v1",
    model: "deepseek-chat",
    fromRussia: true,
    dataInRussia: false,
  },
  {
    id: "openai",
    title: "OpenAI",
    note: "Из России API закрыт — нужен сервер или прокси за рубежом.",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4o-mini",
    fromRussia: false,
    dataInRussia: false,
  },
  {
    id: "custom",
    title: "Другой сервис",
    note: "Любой адрес с OpenAI-совместимым API (OpenRouter, свой сервер).",
    baseUrl: "",
    model: "",
    fromRussia: true,
    dataInRussia: false,
    needsUrl: "https://…/v1",
  },
]

export const presetOf = (id: string) => AI_PRESETS.find((p) => p.id === id) ?? null
