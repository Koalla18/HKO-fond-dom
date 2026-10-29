import { and, eq, isNull } from "drizzle-orm"
import { db, t } from "@/db"
import type { Attachment } from "@/db/schema"
import { APPLICATION_KINDS, fieldText, isApplicationKind, validateFields, type ApplicationKind } from "@/lib/applications/catalog"
import { createApplication } from "@/lib/applications/service"
import { DEFAULT_CATEGORIES } from "@/lib/channels/catalog"
import { ingestIncoming, normalizeEmail } from "@/lib/channels/ingest"
import { saveFile } from "@/lib/storage"
import { loadChannel } from "@/lib/channels/store"
import { clientIp, CORS, json, rateLimited } from "@/lib/public-api"
import { getSetting } from "@/lib/settings"

type Ctx = { params: Promise<{ channelId: string }> }

const KNOWN = new Set(["name", "email", "phone", "message", "text", "subject", "theme", "website", "redirect", "agree", "animal", "type", "category", "kind", "fields", "consent"])
const MAX_PHOTOS = 3
const MAX_PHOTO_BYTES = 10 * 1024 * 1024
const LABELS: Record<string, string> = { city: "Город", age: "Возраст", topic: "Тема", amount: "Сумма" }

/** Формы fundhome.ru шлют поля как form[name], form[theme]… — приводим к плоскому виду. */
function flatKey(key: string) {
  const m = /^form\[([^\]]+)\]$/.exec(key)
  return m ? m[1] : key
}

/** Категория заявки по полям формы: явная, «Взять под опеку» или вид помощи. */
function categoryFor(fields: Record<string, string>) {
  const explicit = DEFAULT_CATEGORIES.find((c) => c === fields.category?.trim())
  if (explicit) return explicit
  const type = (fields.type ?? "").toLowerCase()
  if (type.includes("передерж")) return "Передержка"
  if (fields.animal) return "Опека"
  if (type.includes("финанс")) return "Пожертвование"
  return null
}

/** Формы сайта фонда без явного вида заявки: «Взять под опеку» с анкетой животного, «Возьму на передержку». */
function kindFromSiteForm(fields: Record<string, string>): ApplicationKind | null {
  const type = (fields.type ?? "").toLowerCase()
  if (type.includes("передерж")) return "foster"
  if (fields.animal || type.includes("финанс") || type.includes("паром")) return "guardianship"
  return null
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS })
}

/**
 * Приём заявки с формы сайта. Принимает JSON, обычную форму и multipart.
 * Поля: name, email, phone, subject, message (или text) + любые свои — они попадут в текст заявки.
 * Поле website — ловушка для ботов, люди его не видят и не заполняют.
 */
export async function POST(req: Request, ctx: Ctx) {
  const { channelId } = await ctx.params
  const loaded = /^[0-9a-f-]{36}$/.test(channelId) ? await loadChannel(channelId) : null
  if (!loaded || loaded.channel.kind !== "webform" || !loaded.channel.enabled) return json({ error: "Форма не найдена" }, 404)
  // С адресом — лимит на посетителя; без прокси адреса нет — общий потолок на канал.
  const ip = clientIp(req)
  const limited = ip ? rateLimited(`form:${ip}`, 10, 10 * 60_000) : rateLimited("form:all", 60, 10 * 60_000)
  if (limited) return json({ error: "Слишком много заявок, попробуйте позже" }, 429)

  const type = req.headers.get("content-type") ?? ""
  let fields: Record<string, string> = {}
  // Ответы анкеты платформы: { kind, fields: { species: "Собака", condition: ["…"] } }.
  let answers: Record<string, unknown> = {}
  const photos: File[] = []
  if (type.includes("application/json")) {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
    if (body.fields && typeof body.fields === "object") answers = body.fields as Record<string, unknown>
    fields = Object.fromEntries(Object.entries(body).map(([k, v]) => [flatKey(k), typeof v === "string" ? v : JSON.stringify(v)]))
  } else {
    const form = await req.formData().catch(() => null)
    form?.forEach((v, k) => {
      if (typeof v === "string") {
        const answer = /^answer\[([^\]]+)\]$/.exec(k)
        if (answer) {
          const prev = answers[answer[1]]
          answers[answer[1]] = prev === undefined ? v : ([] as unknown[]).concat(prev, v)
        } else fields[flatKey(k)] = v
      } else if ((k === "photo" || k === "photos") && v.size > 0 && photos.length < MAX_PHOTOS) photos.push(v)
    })
  }
  const val = (k: string) => fields[k]?.toString().trim().slice(0, 5000) || ""
  // Возврат на страницу «Спасибо» — только на обычный http(s)-адрес.
  const redirect = /^https?:\/\/[^\s]+$/i.test(val("redirect")) ? val("redirect") : ""

  if (val("website")) return redirect ? Response.redirect(redirect, 303) : json({ ok: true }) // бот — молча «принимаем»
  const org = await getSetting("org")
  const animal = val("animal")
  const animalUrl = animal ? (animal.startsWith("/") && org.site ? `${org.site.replace(/\/$/, "")}${animal}` : animal) : ""
  const explicitKind = isApplicationKind(val("kind")) ? (val("kind") as ApplicationKind) : null
  const checked = explicitKind ? validateFields(explicitKind, answers, true) : null
  if (checked && Object.keys(checked.errors).length) return json({ error: "Проверьте анкету", errors: checked.errors }, 400)
  const kindMeta = explicitKind ? APPLICATION_KINDS[explicitKind] : null
  const answerLines = kindMeta && checked
    ? kindMeta.fields.filter((f) => fieldText(checked.fields[f.key])).map((f) => `${f.label}: ${fieldText(checked.fields[f.key])}`)
    : []
  const message =
    val("message") ||
    val("text") ||
    (kindMeta ? `Анкета «${kindMeta.title}»` : "") ||
    (animal ? "Хочу взять животное под опеку" : "")
  const email = normalizeEmail(val("email"))
  const phone = val("phone")
  if (!message) return json({ error: "Напишите текст обращения" }, 400)
  if (!email && !phone) return json({ error: "Оставьте почту или телефон, чтобы мы могли ответить" }, 400)
  if (explicitKind && !val("name")) return json({ error: "Как к вам обращаться?", errors: { name: "Заполните поле" } }, 400)
  // Анкета платформы показывает согласие на обработку данных — без отметки не принимаем.
  if (explicitKind && !["on", "true", "1", "yes"].includes(val("consent").toLowerCase())) {
    return json({ error: "Нужно согласие на обработку персональных данных", errors: { consent: "Отметьте согласие" } }, 400)
  }

  const attachments: Attachment[] = []
  for (const photo of photos) {
    if (!photo.type.startsWith("image/") || photo.size > MAX_PHOTO_BYTES) continue
    attachments.push(await saveFile(photo.name || "photo.jpg", photo.type, Buffer.from(await photo.arrayBuffer())))
  }

  const extra = Object.entries(fields)
    .filter(([k, v]) => !KNOWN.has(k) && v.trim())
    .slice(0, 20)
    .map(([k, v]) => `${LABELS[k] ?? k}: ${v.trim().slice(0, 500)}`)
  const details = [
    animalUrl ? `Анкета животного: ${animalUrl}` : "",
    val("type") ? `Вид помощи: ${val("type")}` : "",
    ...extra,
  ].filter(Boolean)
  const text = [message, answerLines.length ? `\n${answerLines.join("\n")}` : "", details.length ? `\n${details.join("\n")}` : ""].join("").trim()

  const result = await ingestIncoming(loaded.channel, {
    externalUserId: email ?? phone,
    replyTo: email ?? phone,
    name: val("name") || undefined,
    email: email ?? undefined,
    phone: phone || undefined,
    subject: val("subject") || val("theme") || kindMeta?.title || (animal ? "Взять под опеку" : "Заявка с сайта"),
    text,
    attachments,
    meta: { page: req.headers.get("referer") ?? null, ...(explicitKind ? { applicationKind: explicitKind } : {}) },
  })
  const appKind = explicitKind ?? kindFromSiteForm(fields)
  if (result && appKind) {
    const siteAnswers = explicitKind ? answers : animalUrl ? { animal: animalUrl } : {}
    const extraAnswers = !explicitKind && appKind === "guardianship" && val("type") ? { format: val("type").toLowerCase().includes("финанс") ? "Ежемесячный платёж" : "Корма и лекарства" } : {}
    try {
      await createApplication({
        kind: appKind,
        fields: { ...siteAnswers, ...extraAnswers },
        strict: false,
        source: explicitKind ? "site" : "form",
        requestId: result.requestId,
        actor: { type: "contact" },
      })
    } catch (err) {
      // Обращение уже во входящих — сбой заявки не должен терять человека.
      console.error("[form] заявка не создана", err)
    }
  }
  const category = categoryFor(fields)
  if (result && category) {
    await db
      .update(t.requests)
      .set({ category })
      .where(and(eq(t.requests.id, result.requestId), isNull(t.requests.category)))
  }
  const success = String(loaded.config.successMessage ?? "Спасибо! Мы получили заявку и скоро свяжемся с вами.")
  return redirect ? Response.redirect(redirect, 303) : json({ ok: true, message: success })
}
