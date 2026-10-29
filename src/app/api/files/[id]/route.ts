import { api, HttpError } from "@/lib/auth"
import { readStoredFile } from "@/lib/storage"

type Ctx = { params: Promise<{ id: string }> }

const INLINE = /^(image\/(png|jpe?g|gif|webp)|audio\/|video\/|application\/pdf)/

export const GET = api(async (_req, ctx: Ctx) => {
  const { id } = await ctx.params
  const file = await readStoredFile(id)
  if (!file) throw new HttpError(404, "Файл не найден")
  // Картинки и PDF открываем в браузере, остальное (в т. ч. HTML и SVG) — только скачиванием.
  const disposition = INLINE.test(file.mime) ? "inline" : "attachment"
  return new Response(new Uint8Array(file.data), {
    headers: {
      "content-type": INLINE.test(file.mime) ? file.mime : "application/octet-stream",
      "content-disposition": `${disposition}; filename*=UTF-8''${encodeURIComponent(file.name)}`,
      "x-content-type-options": "nosniff",
      "cache-control": "private, max-age=86400",
    },
  })
})
