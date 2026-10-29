import type { ChannelKind } from "./catalog"
import type { ChannelAdapter } from "./types"
import { emailAdapter } from "./adapters/email"
import { maxAdapter } from "./adapters/max"
import { okAdapter } from "./adapters/ok"
import { facebookAdapter, instagramAdapter } from "./adapters/meta"
import { manualAdapter, webformAdapter, widgetAdapter } from "./adapters/site"
import { telegramAdapter } from "./adapters/telegram"
import { vkAdapter } from "./adapters/vk"
import { whatsappAdapter } from "./adapters/whatsapp"

const ADAPTERS: Record<ChannelKind, ChannelAdapter> = {
  email: emailAdapter,
  vk: vkAdapter,
  telegram: telegramAdapter,
  max: maxAdapter,
  ok: okAdapter,
  instagram: instagramAdapter,
  facebook: facebookAdapter,
  whatsapp: whatsappAdapter,
  webform: webformAdapter,
  widget: widgetAdapter,
  manual: manualAdapter,
}

export function getAdapter(kind: ChannelKind): ChannelAdapter {
  return ADAPTERS[kind]
}
