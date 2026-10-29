import { SidebarTrigger } from "@/components/ui/sidebar"
import { cn } from "@/lib/utils"

/**
 * Каркас раздела: прокрутка, ширина и отступы одинаковые во всех разделах.
 * fill — раздел сам управляет высотой (входящие, доска заявок).
 */
export function PageShell({ children, fill, className }: { children: React.ReactNode; fill?: boolean; className?: string }) {
  if (fill) return <div className={cn("flex h-full min-h-0 flex-col gap-4 px-4 pt-5 pb-4 sm:px-6 lg:px-8", className)}>{children}</div>
  return (
    <div className="h-full overflow-y-auto scroll-thin">
      <div className={cn("mx-auto max-w-[1440px] space-y-5 px-4 pt-5 pb-14 sm:px-6 lg:px-8", className)}>{children}</div>
    </div>
  )
}

/** Заголовок раздела: крупное имя, пояснение, действия справа. Одинаковый во всех разделах. */
export function PageHeader({ title, description, actions, className }: { title: React.ReactNode; description?: React.ReactNode; actions?: React.ReactNode; className?: string }) {
  return (
    <header className={cn("glass-rise flex flex-wrap items-end justify-between gap-4 pt-2 text-white", className)}>
      <div className="flex min-w-0 items-start gap-2">
        <SidebarTrigger className="mt-1.5 text-white hover:bg-white/10 hover:text-white md:hidden" />
        <div className="min-w-0 space-y-1.5">
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">{title}</h1>
          {description && <div className="max-w-2xl text-[15px] text-white/65">{description}</div>}
        </div>
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </header>
  )
}
