import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { randomUUID } from "node:crypto"
import type { Attachment } from "@/db/schema"

/** Вложения лежат на диске сервера: ./storage/files/<id> + <id>.json с описанием. */
const ROOT = path.join(process.cwd(), "storage", "files")
export const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024

function safeName(name: string) {
  return name.replace(/[\\/\0\r\n]/g, "_").slice(0, 180) || "file"
}

export async function saveFile(name: string, mime: string, data: Buffer): Promise<Attachment> {
  if (data.length > MAX_ATTACHMENT_BYTES) throw new Error("Файл больше 20 МБ")
  await mkdir(ROOT, { recursive: true })
  const id = randomUUID()
  const meta = { name: safeName(name), mime: mime || "application/octet-stream", size: data.length }
  await writeFile(path.join(ROOT, id), data)
  await writeFile(path.join(ROOT, `${id}.json`), JSON.stringify(meta))
  return { ...meta, url: `/api/files/${id}` }
}

export async function readStoredFile(id: string) {
  if (!/^[0-9a-f-]{36}$/.test(id)) return null
  try {
    const meta = JSON.parse(await readFile(path.join(ROOT, `${id}.json`), "utf8")) as { name: string; mime: string; size: number }
    const data = await readFile(path.join(ROOT, id))
    return { ...meta, data }
  } catch {
    return null
  }
}

/** Скачать вложение с площадки к себе: ссылки ВК и Telegram живут недолго. */
export async function downloadToStorage(url: string, fallbackName: string, init?: RequestInit): Promise<Attachment> {
  try {
    const res = await fetch(url, { ...init, signal: AbortSignal.timeout(20_000) })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const declared = Number(res.headers.get("content-length") ?? 0)
    if (declared > MAX_ATTACHMENT_BYTES) throw new Error("слишком большой")
    const data = Buffer.from(await res.arrayBuffer())
    const mime = res.headers.get("content-type")?.split(";")[0] ?? "application/octet-stream"
    return await saveFile(fallbackName, mime, data)
  } catch {
    // Не смогли скачать — оставляем внешнюю ссылку, сообщение важнее файла.
    return { name: fallbackName, mime: "application/octet-stream", url }
  }
}
