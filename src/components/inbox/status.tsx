import type { RequestPriority, RequestStatus } from "@/db/schema"
import { PRIORITY_LABELS, STATUS_LABELS } from "@/lib/channels/catalog"
import { cn } from "@/lib/utils"

export const STATUS_COLORS: Record<RequestStatus, string> = {
  new: "bg-sky-500",
  open: "bg-amber-500",
  waiting: "bg-violet-400",
  resolved: "bg-emerald-500",
  spam: "bg-zinc-400",
}

export function StatusDot({ status, className }: { status: RequestStatus; className?: string }) {
  return <span className={cn("inline-block size-2 shrink-0 rounded-full", STATUS_COLORS[status], className)} title={STATUS_LABELS[status]} />
}

export function StatusLabel({ status }: { status: RequestStatus }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <StatusDot status={status} />
      {STATUS_LABELS[status]}
    </span>
  )
}

export const PRIORITY_TONE: Record<RequestPriority, string> = {
  low: "text-muted-foreground",
  normal: "text-foreground",
  high: "text-amber-300",
  urgent: "text-destructive font-medium",
}

export function PriorityLabel({ priority }: { priority: RequestPriority }) {
  return <span className={PRIORITY_TONE[priority]}>{PRIORITY_LABELS[priority]}</span>
}
