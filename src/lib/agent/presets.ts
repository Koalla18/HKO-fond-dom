/**
 * Модели для ассистента. Все — через OpenAI-совместимый API (/chat/completions), поэтому
 * код один, отличаются адрес, имя модели и заголовки. Файл без серверных зависимостей.
 */
export type AiProvider = "none" | "yandexgpt" | "gigachat" | "deepseek" | "openai" | "custom"

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
}

export const AI_PRESETS: AiPreset[] = [
  {
    id: "yandexgpt",
    title: "YandexGPT",
    note: "Данные в России, оплата рублями. Нужны API-ключ и ID каталога Yandex Cloud.",
    baseUrl: "https://llm.api.cloud.yandex.net/v1",
    model: "gpt://{folder}/yandexgpt/latest",
    needsFolder: true,
    fromRussia: true,
  },
  {
    id: "gigachat",
    title: "GigaChat (cloud.ru)",
    note: "Данные в России. Ключ — в Cloud.ru → Foundation Models.",
    baseUrl: "https://foundation-models.api.cloud.ru/v1",
    model: "ai-sage/GigaChat3-10B-A1.8B",
    fromRussia: true,
  },
  {
    id: "deepseek",
    title: "DeepSeek",
    note: "Недорого, отвечает из России. Данные уходят за рубеж — имена и телефоны ассистенту не нужны.",
    baseUrl: "https://api.deepseek.com/v1",
    model: "deepseek-chat",
    fromRussia: true,
  },
  {
    id: "openai",
    title: "OpenAI",
    note: "Из России API закрыт — нужен сервер или прокси за рубежом.",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4o-mini",
    fromRussia: false,
  },
  {
    id: "custom",
    title: "Другой сервис",
    note: "Любой адрес с OpenAI-совместимым API (Timeweb, OpenRouter, свой сервер).",
    baseUrl: "",
    model: "",
    fromRussia: true,
  },
]

export const presetOf = (id: string) => AI_PRESETS.find((p) => p.id === id) ?? null
