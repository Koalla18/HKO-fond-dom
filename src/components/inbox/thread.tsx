"use client"

import { AlertTriangle, ArrowLeft, Bot, Check, CheckCheck, Clock, Copy, CornerUpLeft, FileIcon, Loader2, Paperclip, Send, ShieldAlert, StickyNote, X } from "lucide-react"
import Link from "next/link"
import { useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { useSWRConfig } from "swr"
import { ChannelIcon } from "@/components/app/channel-icon"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import type { Attachment } from "@/db/schema"
import type { RequestDetail, ThreadMessage } from "@/lib/api-types"
import { CHANNELS, STATUS_LABELS, type ChannelKind } from "@/lib/channels/catalog"
import { apiFetch } from "@/lib/client"
import { fullTime, initials, shortTime } from "@/lib/format"
import { cn } from "@/lib/utils"
import { EmojiPicker } from "./emoji-picker"
import { StatusDot } from "./status"

type Replying = { id: string; author: string; text: string }

function messageExcerpt(m: ThreadMessage) {
  const line = m.text.replace(/\s+/g, " ").trim()
  if (line) return line.length > 160 ? `${line.slice(0, 159)}…` : line
  return m.attachments.length === 1 ? `Файл: ${m.attachments[0].name}` : m.attachments.length ? `Файлов: ${m.attachments.length}` : "Сообщение"
}

function authorOf(m: ThreadMessage, contactName: string) {
  if (m.direction === "in") return contactName
  if (m.authorType === "ai") return "Ассистент"
  if (m.authorType === "system") return "Система"
  return m.authorName ?? "Фонд"
}

/** Прокрутить к сообщению и подсветить его — для цитат. */
function jumpTo(id: string) {
  const el = document.querySelector<HTMLElement>(`[data-message-id="${id}"]`)
  if (!el) return
  el.scrollIntoView({ block: "center", behavior: "smooth" })
  el.classList.remove("message-flash")
  void el.offsetWidth
  el.classList.add("message-flash")
}

export function Thread({ detail, backHref, onChanged }: { detail: RequestDetail; backHref: string; onChanged: () => void }) {
  const { request, contact, channel } = detail
  const meta = CHANNELS[channel.kind as ChannelKind]
  const bottom = useRef<HTMLDivElement>(null)
  const count = detail.messages.length
  // Ответ помнит, к какому обращению относится: при переходе к другому он просто не показывается.
  const [replyState, setReplyState] = useState<(Replying & { requestId: string }) | null>(null)
  const replying = replyState?.requestId === request.id ? replyState : null
  const setReplying = (r: Replying | null) => setReplyState(r ? { ...r, requestId: request.id } : null)

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" })
  }, [request.id, count])

  async function patch(body: Record<string, unknown>, done?: string) {
    try {
      await apiFetch(`/api/requests/${request.id}`, { method: "PATCH", json: body })
      if (done) toast.success(done)
      onChanged()
    } catch (err) {
      toast.error((err as Error).message)
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex items-center gap-3 border-b border-white/10 px-4 py-3">
        <Button asChild variant="ghost" size="icon-sm" className="lg:hidden">
          <Link href={backHref} aria-label="Назад к списку">
            <ArrowLeft />
          </Link>
        </Button>
        <Avatar className="size-9">
          {contact.avatarUrl && <AvatarImage src={contact.avatarUrl} alt="" />}
          <AvatarFallback className="bg-secondary text-sm">{initials(contact.name)}</AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h2 className="truncate font-semibold">{contact.name}</h2>
            <span className="shrink-0 text-xs text-muted-foreground tabular-nums">#{request.number}</span>
          </div>
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <ChannelIcon kind={channel.kind} size="xs" />
            <span className="truncate">{meta && !channel.name.startsWith(meta.title) ? `${meta.title} · ${channel.name}` : channel.name}</span>
            <span aria-hidden>·</span>
            <StatusDot status={request.status} />
            <span className="whitespace-nowrap">{STATUS_LABELS[request.status]}</span>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {request.status === "spam" ? (
            <Button size="sm" variant="outline" onClick={() => patch({ status: "open" }, "Обращение возвращено в работу")}>
              Не спам
            </Button>
          ) : (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button size="icon-sm" variant="ghost" onClick={() => patch({ status: "spam" }, "Перенесено в спам")} aria-label="В спам">
                  <ShieldAlert />
                </Button>
              </TooltipTrigger>
              <TooltipContent>В спам</TooltipContent>
            </Tooltip>
          )}
          {request.status === "resolved" ? (
            <Button size="sm" variant="outline" onClick={() => patch({ status: "open" }, "Обращение снова в работе")}>
              Открыть снова
            </Button>
          ) : (
            <Button size="sm" onClick={() => patch({ status: "resolved" }, "Обращение решено")}>
              <Check />
              Решено
            </Button>
          )}
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 scroll-thin">
        <div className="mx-auto flex max-w-3xl flex-col gap-3">
          <p className="text-center text-xs text-muted-foreground">
            Обращение создано {fullTime(request.createdAt)} · {meta?.title ?? channel.kind}
          </p>
          {detail.messages.map((m) => (
            <MessageItem
              key={m.id}
              message={m}
              contactName={contact.name}
              onReply={() => setReplying({ id: m.id, author: authorOf(m, contact.name), text: messageExcerpt(m) })}
            />
          ))}
          <div ref={bottom} />
        </div>
      </div>

      <Composer key={request.id} detail={detail} onSent={onChanged} replying={replying} onCancelReply={() => setReplying(null)} />
    </div>
  )
}

function Attachments({ files, inverted }: { files: Attachment[]; inverted?: boolean }) {
  if (!files.length) return null
  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {files.map((f, i) =>
        f.url && f.mime.startsWith("image/") ? (
          <a key={i} href={f.url} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-xl border border-white/10 bg-black/20">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={f.url} alt={f.name} className="max-h-56 max-w-[240px] object-cover" loading="lazy" />
          </a>
        ) : (
          <a
            key={i}
            href={f.url || undefined}
            target="_blank"
            rel="noreferrer"
            className={cn(
              "flex max-w-[260px] items-center gap-2 rounded-lg border px-2.5 py-1.5 text-xs",
              inverted ? "border-black/15 bg-black/10" : "bg-white/[0.07]",
              !f.url && "opacity-70",
            )}
            title={f.url ? f.name : "Файл не удалось сохранить"}
          >
            <FileIcon className="size-4 shrink-0" />
            <span className="truncate">{f.name}</span>
          </a>
        ),
      )}
    </div>
  )
}

function Quote({ reply, inverted }: { reply: NonNullable<ThreadMessage["replyTo"]>; inverted?: boolean }) {
  const body = (
    <span className={cn("block border-l-2 py-0.5 pl-2 text-xs leading-snug", inverted ? "border-[#04192b]/40 text-[#04192b]/75" : "border-primary/70 text-white/70")}>
      <span className="line-clamp-2">{reply.text}</span>
    </span>
  )
  return reply.id ? (
    <button type="button" onClick={() => jumpTo(reply.id!)} className="mb-1.5 block w-full text-left" title="Показать сообщение">
      {body}
    </button>
  ) : (
    <span className="mb-1.5 block">{body}</span>
  )
}

function MessageActions({ message: m, onReply, align }: { message: ThreadMessage; onReply: () => void; align: "start" | "end" }) {
  return (
    <div
      className={cn(
        "flex shrink-0 items-center gap-0.5 self-center opacity-0 transition-opacity group-hover/msg:opacity-100 group-focus-within/msg:opacity-100",
        align === "end" && "order-first",
      )}
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <Button type="button" variant="ghost" size="icon-xs" onClick={onReply} aria-label="Ответить на сообщение">
            <CornerUpLeft />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Ответить</TooltipContent>
      </Tooltip>
      {m.text && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label="Скопировать текст"
              onClick={() =>
                navigator.clipboard.writeText(m.text).then(
                  () => toast.success("Текст скопирован"),
                  () => toast.error("Не удалось скопировать"),
                )
              }
            >
              <Copy />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Скопировать</TooltipContent>
        </Tooltip>
      )}
    </div>
  )
}

function MessageItem({ message: m, contactName, onReply }: { message: ThreadMessage; contactName: string; onReply: () => void }) {
  if (m.authorType === "system") {
    return (
      <p className="mx-auto max-w-md text-center text-xs text-muted-foreground">
        {m.text} · {shortTime(m.createdAt)}
      </p>
    )
  }
  if (m.direction === "internal") {
    return (
      <div data-message-id={m.id} className="group/msg mx-auto w-full max-w-xl rounded-2xl border border-amber-300/25 bg-amber-300/10 px-3.5 py-2.5 text-sm text-amber-50">
        <div className="mb-1 flex items-center gap-1.5 text-xs font-medium text-amber-200">
          {m.authorType === "ai" ? <Bot className="size-3.5" /> : <StickyNote className="size-3.5" />}
          {m.authorType === "ai" ? "Ассистент" : `Заметка · ${m.authorName ?? "сотрудник"}`}
          <span className="ml-auto font-normal text-amber-200/70">{shortTime(m.createdAt)}</span>
          <button
            type="button"
            onClick={onReply}
            className="rounded p-0.5 text-amber-200/70 opacity-0 transition-opacity group-hover/msg:opacity-100 hover:text-amber-100 focus-visible:opacity-100"
            aria-label="Ответить на заметку"
          >
            <CornerUpLeft className="size-3.5" />
          </button>
        </div>
        {m.replyTo && <Quote reply={m.replyTo} />}
        <p className="whitespace-pre-wrap [overflow-wrap:anywhere]">{m.text}</p>
        <Attachments files={m.attachments} />
      </div>
    )
  }
  const incoming = m.direction === "in"
  return (
    <div data-message-id={m.id} className={cn("group/msg flex items-end gap-1.5 rounded-2xl", incoming ? "justify-start" : "justify-end")}>
      <div className={cn("max-w-[78%] min-w-0 space-y-1", !incoming && "items-end text-right")}>
        <div className={cn("flex items-center gap-1.5 text-[11px] text-muted-foreground", !incoming && "justify-end")}>
          {incoming ? contactName : m.authorType === "ai" ? (
            <>
              <Bot className="size-3" /> Ассистент
            </>
          ) : (
            m.authorName ?? "Фонд"
          )}
          <span aria-hidden>·</span>
          <time title={fullTime(m.createdAt)}>{shortTime(m.createdAt)}</time>
        </div>
        <div
          className={cn(
            "inline-block rounded-2xl px-3.5 py-2 text-left text-sm leading-relaxed shadow-xs",
            incoming ? "rounded-tl-md border border-white/12 bg-white/[0.1] text-white" : "rounded-tr-md bg-gradient-to-br from-[#2fd3f5] to-[#0a9ec4] text-[#04192b]",
            m.delivery === "failed" && "ring-2 ring-destructive/60",
          )}
        >
          {m.replyTo && <Quote reply={m.replyTo} inverted={!incoming} />}
          {m.text && <p className={cn("whitespace-pre-wrap [overflow-wrap:anywhere]", isOnlyEmoji(m.text) && "text-3xl leading-tight")}>{m.text}</p>}
          <Attachments files={m.attachments} inverted={!incoming} />
        </div>
        {!incoming && <Delivery message={m} />}
      </div>
      <MessageActions message={m} onReply={onReply} align={incoming ? "start" : "end"} />
    </div>
  )
}

/** Сообщение из одного-трёх смайликов показываем крупно, как в мессенджерах. */
function isOnlyEmoji(text: string) {
  const t = text.trim()
  if (!t || t.length > 24) return false
  return /^(?:\p{Extended_Pictographic}|\p{Emoji_Component}|\u200d|\ufe0f|\s)+$/u.test(t) && [...new Intl.Segmenter().segment(t.replace(/\s/g, ""))].length <= 3
}

function Delivery({ message: m }: { message: ThreadMessage }) {
  if (m.delivery === "pending")
    return (
      <p className="flex items-center justify-end gap-1 text-[11px] text-muted-foreground">
        <Clock className="size-3" /> отправляется
      </p>
    )
  if (m.delivery === "failed")
    return (
      <p className="flex items-start justify-end gap-1 text-[11px] text-destructive">
        <AlertTriangle className="mt-px size-3 shrink-0" /> Не доставлено: {m.deliveryError}
      </p>
    )
  if (m.delivery === "sent")
    return (
      <p className="flex items-center justify-end gap-1 text-[11px] text-muted-foreground">
        <CheckCheck className="size-3" /> отправлено
      </p>
    )
  return null
}

function Composer({
  detail,
  onSent,
  replying,
  onCancelReply,
}: {
  detail: RequestDetail
  onSent: () => void
  replying: Replying | null
  onCancelReply: () => void
}) {
  const { mutate } = useSWRConfig()
  const meta = CHANNELS[detail.channel.kind as ChannelKind]
  const canReply = meta?.canReply ?? false
  const [mode, setMode] = useState<"reply" | "note">(canReply ? "reply" : "note")
  const draftKey = `draft:${detail.request.id}`
  // Черновик переживает переход между заявками (Composer пересоздаётся по key заявки).
  const [text, setText] = useState(() => (typeof window === "undefined" ? "" : (sessionStorage.getItem(draftKey) ?? "")))
  const [files, setFiles] = useState<Attachment[]>([])
  const [busy, setBusy] = useState(false)
  const [uploading, setUploading] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const textArea = useRef<HTMLTextAreaElement>(null)
  const [dragging, setDragging] = useState(false)

  useEffect(() => {
    if (replying) textArea.current?.focus()
  }, [replying])

  function insertAtCursor(value: string) {
    const el = textArea.current
    if (!el) return setText((prev) => prev + value)
    const start = el.selectionStart ?? text.length
    const end = el.selectionEnd ?? text.length
    const next = text.slice(0, start) + value + text.slice(end)
    setText(next)
    requestAnimationFrame(() => {
      el.focus()
      el.setSelectionRange(start + value.length, start + value.length)
    })
  }

  useEffect(() => {
    if (text) sessionStorage.setItem(draftKey, text)
    else sessionStorage.removeItem(draftKey)
  }, [text, draftKey])

  const filesAllowed = mode === "note" || meta?.canSendFiles

  async function upload(list: FileList | File[] | null) {
    if (!list?.length) return
    if (!filesAllowed) {
      toast.error(`${meta?.title}: файлы отсюда пока не отправляются — пришлите ссылку текстом или сохраните в заметку`)
      return
    }
    setUploading(true)
    try {
      for (const file of Array.from(list).slice(0, 10 - files.length)) {
        const form = new FormData()
        form.set("file", file)
        const res = await apiFetch<{ attachment: Attachment }>("/api/uploads", { method: "POST", body: form })
        setFiles((prev) => [...prev, res.attachment])
      }
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setUploading(false)
      if (fileInput.current) fileInput.current.value = ""
    }
  }

  async function submit() {
    if (busy || (!text.trim() && !files.length)) return
    setBusy(true)
    try {
      const res = await apiFetch<{ message: { delivery: string | null; deliveryError: string | null } }>(`/api/requests/${detail.request.id}/messages`, {
        method: "POST",
        json: { text, internal: mode === "note", attachments: files, replyToId: replying?.id ?? null },
      })
      setText("")
      setFiles([])
      onCancelReply()
      if (res.message.delivery === "failed") toast.error(`Не доставлено: ${res.message.deliveryError}`)
      onSent()
      void mutate((key) => typeof key === "string" && key.startsWith("/api/requests?"))
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  // Адрес показываем только там, где он что-то говорит человеку: почта.
  const address = /@/.test(detail.request.replyTo) ? ` · ${detail.request.replyTo}` : ""
  const target = canReply ? `${meta?.title ?? detail.channel.kind}${address}` : null

  return (
    <div className="border-t border-white/10 px-4 pt-2 pb-3">
      <div className="mx-auto max-w-3xl">
        <div className="mb-2 flex items-center gap-1 text-sm">
          <button
            type="button"
            disabled={!canReply}
            onClick={() => setMode("reply")}
            className={cn(
              "shrink-0 rounded-md px-2.5 py-1 font-medium whitespace-nowrap transition-colors disabled:cursor-not-allowed disabled:opacity-40",
              mode === "reply" ? "bg-white text-[#0c143b]" : "text-muted-foreground hover:bg-white/10",
            )}
          >
            Ответ
          </button>
          <button
            type="button"
            onClick={() => setMode("note")}
            className={cn(
              "shrink-0 rounded-md px-2.5 py-1 font-medium whitespace-nowrap transition-colors",
              mode === "note" ? "bg-amber-300 text-amber-950" : "text-muted-foreground hover:bg-white/10",
            )}
          >
            Заметка
          </button>
          <span className="ml-auto flex min-w-0 items-center gap-1.5 overflow-hidden text-xs text-muted-foreground">
            {mode === "reply" && target ? (
              <>
                <ChannelIcon kind={detail.channel.kind} size="xs" />
                <span className="truncate">Уйдёт: {target}</span>
              </>
            ) : mode === "note" ? (
              "Видна только сотрудникам"
            ) : (
              "В этот канал ответить нельзя"
            )}
          </span>
        </div>
        <div
          className={cn(
            "relative rounded-xl border bg-card shadow-xs focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/20",
            mode === "note" && "border-amber-300/40 bg-amber-300/10",
            dragging && "border-primary ring-3 ring-primary/30",
          )}
          onDragOver={(e) => {
            if (!e.dataTransfer.types.includes("Files")) return
            e.preventDefault()
            setDragging(true)
          }}
          onDragLeave={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false)
          }}
          onDrop={(e) => {
            if (!e.dataTransfer.files.length) return
            e.preventDefault()
            setDragging(false)
            void upload(e.dataTransfer.files)
          }}
        >
          {dragging && (
            <div className="pointer-events-none absolute inset-0 z-10 grid place-items-center rounded-xl bg-black/50 text-sm font-medium">
              Отпустите, чтобы приложить
            </div>
          )}
          {replying && (
            <div className="flex items-start gap-2 border-b border-white/10 px-3 py-2" data-reply-preview>
              <CornerUpLeft className="mt-0.5 size-4 shrink-0 text-primary" />
              <div className="min-w-0 flex-1 text-xs">
                <p className="font-medium text-primary">Ответ на сообщение · {replying.author}</p>
                <p className="truncate text-muted-foreground">{replying.text}</p>
              </div>
              <button type="button" onClick={onCancelReply} className="rounded p-0.5 text-muted-foreground hover:bg-white/10 hover:text-foreground" aria-label="Отменить ответ">
                <X className="size-4" />
              </button>
            </div>
          )}
          <Textarea
            ref={textArea}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onPaste={(e) => {
              const pasted = Array.from(e.clipboardData.files)
              if (!pasted.length) return
              e.preventDefault()
              void upload(pasted)
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape" && replying) {
                e.preventDefault()
                onCancelReply()
                return
              }
              // Как в мессенджерах: Enter — отправить, Shift+Enter — новая строка.
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault()
                void submit()
              }
            }}
            placeholder={mode === "note" ? "Заметка: что выяснили, кому передать…" : "Напишите ответ…"}
            className="max-h-60 min-h-20 resize-none border-0 bg-transparent shadow-none focus-visible:ring-0"
            aria-label={mode === "note" ? "Текст заметки" : "Текст ответа"}
          />
          {files.length > 0 && (
            <div className="flex flex-wrap gap-1.5 px-3 pb-2">
              {files.map((f, i) => (
                <span key={f.url} className="flex items-center gap-1 rounded-lg border border-white/10 bg-white/[0.07] px-2 py-1 text-xs">
                  <FileIcon className="size-3.5" />
                  <span className="max-w-40 truncate">{f.name}</span>
                  <button type="button" onClick={() => setFiles((prev) => prev.filter((_, j) => j !== i))} aria-label={`Убрать ${f.name}`}>
                    <X className="size-3.5" />
                  </button>
                </span>
              ))}
            </div>
          )}
          <div className="flex items-center gap-2 px-2 pb-2">
            <input ref={fileInput} type="file" multiple hidden onChange={(e) => void upload(e.target.files)} />
            <Tooltip>
              <TooltipTrigger asChild>
                <span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    disabled={!filesAllowed || uploading}
                    onClick={() => fileInput.current?.click()}
                    aria-label="Приложить файл"
                  >
                    {uploading ? <Loader2 className="animate-spin" /> : <Paperclip />}
                  </Button>
                </span>
              </TooltipTrigger>
              <TooltipContent>{filesAllowed ? "Приложить файл (можно вставить или перетащить)" : `${meta?.title}: файлы отсюда пока не отправляются`}</TooltipContent>
            </Tooltip>
            <EmojiPicker onPick={insertAtCursor} />
            <span className="hidden min-w-0 truncate text-[11px] text-muted-foreground sm:inline" title="Enter — отправить, Shift+Enter — новая строка">
              Shift+Enter — новая строка
            </span>
            <Button type="button" size="sm" className="ml-auto" disabled={busy || (!text.trim() && !files.length) || (mode === "reply" && !canReply)} onClick={submit}>
              {busy ? <Loader2 className="animate-spin" /> : mode === "note" ? <StickyNote /> : <Send />}
              {mode === "note" ? "Сохранить заметку" : "Отправить"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
