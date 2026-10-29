import { z } from "zod"
import { HttpError } from "./auth"

export async function readJson<T extends z.ZodType>(req: Request, schema: T): Promise<z.infer<T>> {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    throw new HttpError(400, "Ожидался JSON")
  }
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    throw new HttpError(400, `${issue.path.join(".") || "Данные"}: ${issue.message}`)
  }
  return parsed.data
}
