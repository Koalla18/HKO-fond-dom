import { api, HttpError } from "@/lib/auth"
import { MAX_ATTACHMENT_BYTES, saveFile } from "@/lib/storage"

/** Файл для ответа: сначала загружаем, потом прикладываем к сообщению. */
export const POST = api(async (req) => {
  const form = await req.formData().catch(() => null)
  const file = form?.get("file")
  if (!(file instanceof File)) throw new HttpError(400, "Нет файла")
  if (file.size > MAX_ATTACHMENT_BYTES) throw new HttpError(413, "Файл больше 20 МБ")
  return { attachment: await saveFile(file.name, file.type, Buffer.from(await file.arrayBuffer())) }
})
