import { getSessionUser } from "@/lib/auth"
import { subscribe } from "@/lib/events"

export const dynamic = "force-dynamic"

/** Живые обновления интерфейса: новые заявки и сообщения приходят без перезагрузки. */
export async function GET(req: Request) {
  const user = await getSessionUser()
  if (!user) return new Response("unauthorized", { status: 401 })
  const encoder = new TextEncoder()
  let cleanup = () => {}
  const stream = new ReadableStream({
    start(controller) {
      const send = (chunk: string) => {
        try {
          controller.enqueue(encoder.encode(chunk))
        } catch {
          cleanup()
        }
      }
      send(": connected\n\n")
      const unsubscribe = subscribe((event) => send(`data: ${JSON.stringify(event)}\n\n`))
      const ping = setInterval(() => send(": ping\n\n"), 25_000)
      cleanup = () => {
        clearInterval(ping)
        unsubscribe()
      }
      req.signal.addEventListener("abort", () => {
        cleanup()
        try {
          controller.close()
        } catch {}
      })
    },
    cancel() {
      cleanup()
    },
  })
  return new Response(stream, {
    headers: { "content-type": "text/event-stream", "cache-control": "no-cache, no-transform", connection: "keep-alive", "x-accel-buffering": "no" },
  })
}
