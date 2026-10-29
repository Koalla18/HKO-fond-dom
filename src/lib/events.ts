import { EventEmitter } from "node:events"

/** Событие для живого обновления интерфейса (SSE). */
export type LiveEvent =
  | { type: "request.created"; requestId: string }
  | { type: "request.updated"; requestId: string }
  | { type: "message.created"; requestId: string; messageId: string }
  | { type: "channel.updated"; channelId: string }
  | { type: "application.created"; applicationId: string; requestId?: string | null }
  | { type: "application.updated"; applicationId: string; requestId?: string | null }

declare global {
  var __domBus: EventEmitter | undefined
}

// Один экземпляр на процесс: платформа рассчитана на один сервер.
const bus = globalThis.__domBus ?? new EventEmitter()
bus.setMaxListeners(200)
globalThis.__domBus = bus

export function publish(event: LiveEvent) {
  bus.emit("live", event)
}

export function subscribe(listener: (event: LiveEvent) => void): () => void {
  bus.on("live", listener)
  return () => bus.off("live", listener)
}
