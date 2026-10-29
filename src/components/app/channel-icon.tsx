import { FileText, Mail, MessageCircle, Phone } from "lucide-react"
import { siFacebook, siInstagram, siOdnoklassniki, siTelegram, siVk, siWhatsapp } from "simple-icons"
import { CHANNELS, type ChannelKind } from "@/lib/channels/catalog"
import { cn } from "@/lib/utils"

const BRAND_PATHS: Partial<Record<ChannelKind, string>> = {
  vk: siVk.path,
  telegram: siTelegram.path,
  instagram: siInstagram.path,
  facebook: siFacebook.path,
  whatsapp: siWhatsapp.path,
  ok: siOdnoklassniki.path,
}

const LUCIDE: Partial<Record<ChannelKind, typeof Mail>> = {
  email: Mail,
  webform: FileText,
  widget: MessageCircle,
  manual: Phone,
}

/** Значок источника заявки: фирменная плитка площадки. */
export function ChannelIcon({ kind, className, size = "md" }: { kind: string; className?: string; size?: "xs" | "sm" | "md" | "lg" }) {
  const meta = CHANNELS[kind as ChannelKind]
  const box = { xs: "size-4 rounded-[5px]", sm: "size-5 rounded-md", md: "size-7 rounded-lg", lg: "size-10 rounded-xl" }[size]
  const glyph = { xs: "size-2.5", sm: "size-3", md: "size-4", lg: "size-5" }[size]
  const brand = BRAND_PATHS[kind as ChannelKind]
  const Lucide = LUCIDE[kind as ChannelKind]
  return (
    <span
      className={cn("inline-grid shrink-0 place-items-center text-white", box, className)}
      style={{ background: meta?.color ?? "#64748b" }}
      title={meta?.title}
      aria-label={meta?.title}
    >
      {brand ? (
        <svg viewBox="0 0 24 24" className={glyph} fill="currentColor" aria-hidden>
          <path d={brand} />
        </svg>
      ) : Lucide ? (
        <Lucide className={glyph} strokeWidth={2.2} aria-hidden />
      ) : (
        <span className={cn("font-bold leading-none", size === "lg" ? "text-xs" : "text-[9px]")}>MAX</span>
      )}
    </span>
  )
}
