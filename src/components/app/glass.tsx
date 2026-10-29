"use client"

import { ArrowDownRight, ArrowUpRight } from "lucide-react"
import { useId } from "react"
import { cn } from "@/lib/utils"

/** Стеклянная карточка: полупрозрачный фон, размытие того, что под ней, тонкий блик сверху. */
export function Glass({
  className,
  children,
  as: Tag = "section",
  style,
  ...rest
}: { className?: string; children: React.ReactNode; as?: "section" | "div" | "header" | "aside"; style?: React.CSSProperties } & Omit<React.HTMLAttributes<HTMLElement>, "className" | "style" | "children">) {
  return (
    <Tag className={cn("glass-card rounded-[28px] text-white", className)} style={style} {...rest}>
      {children}
    </Tag>
  )
}

/** Кнопка-«капсула» на стекле: вторичные действия во всех разделах. */
export function GlassButton({ className, active, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean }) {
  return (
    <button
      type="button"
      {...props}
      className={cn(
        "glass-chip inline-flex items-center gap-2 rounded-full px-4 py-2.5 text-sm whitespace-nowrap disabled:opacity-50 [&_svg]:size-4",
        active && "bg-white! font-medium text-[#0c143b]!",
        className,
      )}
    />
  )
}

/** Переключатель-капсула (период, вид доски, фильтры). */
export function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: { id: T; label: React.ReactNode }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="glass-chip flex rounded-full p-1" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          role="radio"
          aria-checked={value === o.id}
          onClick={() => onChange(o.id)}
          className={cn(
            "flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm whitespace-nowrap transition-colors [&_svg]:size-3.5",
            value === o.id ? "bg-white font-medium text-[#0c143b] shadow" : "text-white/75 hover:text-white",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function GlassTitle({ title, hint, action }: { title: string; hint?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <h2 className="text-[15px] font-semibold tracking-tight text-white">{title}</h2>
        {hint && <p className="mt-0.5 text-xs text-white/55">{hint}</p>}
      </div>
      {action}
    </div>
  )
}

/** Сравнение с прошлым периодом. Для «плохих» метрик рост не зелёный — но у фонда все метрики «чем больше, тем лучше». */
export function Delta({ value, prev, suffix = "%" }: { value: number | null; prev: number | null; suffix?: string }) {
  if (value == null || prev == null) return null
  if (prev === 0 && value === 0) return <span className="rounded-full bg-white/10 px-2 py-0.5 text-[11px] text-white/60">как раньше</span>
  const diff = suffix === "п.п." ? value - prev : prev === 0 ? 100 : Math.round(((value - prev) / prev) * 100)
  const up = diff >= 0
  const Icon = up ? ArrowUpRight : ArrowDownRight
  // Рост в разы читается проще процентов: «×19», а не «+1790%».
  const times = suffix !== "п.п." && prev > 0 && value / prev >= 4 ? Math.round(value / prev) : null
  if (times) {
    return (
      <span className="inline-flex items-center gap-0.5 rounded-full bg-emerald-400/20 px-1.5 py-0.5 text-[11px] font-semibold text-emerald-200 tabular-nums" title="К прошлому периоду той же длины">
        <Icon className="size-3" />×{times}
      </span>
    )
  }
  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[11px] font-semibold tabular-nums",
        up ? "bg-emerald-400/20 text-emerald-200" : "bg-rose-400/20 text-rose-200",
      )}
      title="К прошлому периоду той же длины"
    >
      <Icon className="size-3" />
      {up ? "+" : "−"}
      {Math.abs(diff)}
      {suffix === "п.п." ? " п.п." : "%"}
    </span>
  )
}

function smoothPath(points: [number, number][]) {
  if (points.length < 2) return ""
  let d = `M${points[0][0]},${points[0][1]}`
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] ?? points[i]
    const p1 = points[i]
    const p2 = points[i + 1]
    const p3 = points[i + 2] ?? p2
    const c1x = p1[0] + (p2[0] - p0[0]) / 6
    const c1y = p1[1] + (p2[1] - p0[1]) / 6
    const c2x = p2[0] - (p3[0] - p1[0]) / 6
    const c2y = p2[1] - (p3[1] - p1[1]) / 6
    d += ` C${c1x.toFixed(1)},${c1y.toFixed(1)} ${c2x.toFixed(1)},${c2y.toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`
  }
  return d
}

/** Мини-график под цифрой: плавная линия с подсветкой снизу и точкой на последнем значении. */
export function Sparkline({ values, color, className }: { values: (number | null)[]; color: string; className?: string }) {
  const id = useId()
  const w = 120
  const h = 40
  const clean = values.map((v) => v ?? 0)
  const max = Math.max(1, ...clean)
  const min = Math.min(...clean)
  const span = Math.max(1, max - min)
  const pts: [number, number][] = clean.map((v, i) => [(i / Math.max(1, clean.length - 1)) * w, h - 4 - ((v - min) / span) * (h - 10)])
  const line = smoothPath(pts)
  const last = pts[pts.length - 1]
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className={cn("h-10 overflow-visible", className ?? "w-28")} aria-hidden>
      <defs>
        <linearGradient id={`${id}-fill`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.45" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      {line && (
        <>
          <path d={`${line} L${w},${h} L0,${h} Z`} fill={`url(#${id}-fill)`} />
          <path d={line} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" vectorEffect="non-scaling-stroke" className="spark-draw" />
          {last && <circle cx={last[0]} cy={last[1]} r="3" fill="#fff" stroke={color} strokeWidth="2" vectorEffect="non-scaling-stroke" />}
        </>
      )}
    </svg>
  )
}

/** Кольцо прогресса к цели. */
export function Ring({ value, goal, color, size = 104, children }: { value: number; goal: number; color: string; size?: number; children?: React.ReactNode }) {
  const stroke = 9
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const share = goal > 0 ? Math.min(1, value / goal) : 0
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg viewBox={`0 0 ${size} ${size}`} className="-rotate-90" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,.12)" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - share)}
          className="ring-progress"
          style={{ filter: `drop-shadow(0 0 6px ${color}88)` }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">{children}</div>
    </div>
  )
}
