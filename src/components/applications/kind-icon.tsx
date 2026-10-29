import { HandHeart, HeartHandshake, House, Package, PawPrint, Sofa, Stethoscope, type LucideIcon } from "lucide-react"
import { APPLICATION_KINDS, isApplicationKind, type ApplicationKindMeta } from "@/lib/applications/catalog"
import { cn } from "@/lib/utils"

export const KIND_ICONS: Record<ApplicationKindMeta["icon"], LucideIcon> = {
  paw: PawPrint,
  home: House,
  heart: HeartHandshake,
  sofa: Sofa,
  hand: HandHeart,
  package: Package,
  stethoscope: Stethoscope,
}

/** Значок вида заявки: цветная плитка с иконкой. */
export function KindIcon({ kind, size = "md", className }: { kind: string; size?: "sm" | "md" | "lg"; className?: string }) {
  const meta = isApplicationKind(kind) ? APPLICATION_KINDS[kind] : null
  const Icon = meta ? KIND_ICONS[meta.icon] : PawPrint
  const box = size === "sm" ? "size-6 rounded-md" : size === "lg" ? "size-12 rounded-2xl" : "size-9 rounded-xl"
  const icon = size === "sm" ? "size-3.5" : size === "lg" ? "size-6" : "size-[18px]"
  return (
    <span
      className={cn("inline-flex shrink-0 items-center justify-center", box, className)}
      style={{ background: `color-mix(in oklab, ${meta?.color ?? "#64748b"} 26%, transparent)`, color: meta?.color ?? "#64748b" }}
      aria-hidden
    >
      <Icon className={icon} strokeWidth={2.2} />
    </span>
  )
}
