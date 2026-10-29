import type { Metadata } from "next"
import { Suspense } from "react"
import { getSetting } from "@/lib/settings"
import { LoginForm } from "./login-form"

export const metadata: Metadata = { title: "Вход" }
// Название и логотип фонда берутся из настроек — страница собирается на каждый запрос.
export const dynamic = "force-dynamic"

export default async function LoginPage() {
  const org = await getSetting("org")
  return (
    <main className="relative grid min-h-svh place-items-center overflow-hidden p-4 lg:grid-cols-[1.15fr_1fr] lg:place-items-stretch lg:p-6">
      <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 bg-[#070b18]">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/scene/window.webp" alt="" className="scene-photo h-full w-full object-cover object-[30%_55%]" />
        <div className="absolute inset-0 bg-[linear-gradient(115deg,rgba(6,10,26,.7)_0%,rgba(6,10,26,.3)_50%,rgba(6,10,26,.6)_100%)]" />
      </div>
      <section className="hidden flex-col justify-between p-8 text-white lg:flex">
        {org.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={org.logoUrl} alt={org.name} className="h-14 w-auto self-start brightness-0 invert" />
        ) : (
          <span className="text-lg font-semibold">{org.name}</span>
        )}
        <div className="glass-rise max-w-lg space-y-5">
          <p className="text-sm font-medium tracking-wide text-[#7ee3fa] uppercase">Единое окно заявок</p>
          <h1 className="text-4xl leading-tight font-semibold tracking-tight">Ни одно обращение о помощи животному не потеряется.</h1>
          <p className="text-base leading-relaxed text-white/75">
            Сообщения из ВКонтакте, Telegram, MAX, Одноклассников, почты и сайта собираются в одну очередь, а ассистент сам оформляет из них заявки:
            нашли животное, хотят взять питомца, готовы к передержке.
          </p>
          <ul className="grid grid-cols-2 gap-2 text-sm">
            {["Один человек — одна история", "Ответ уходит туда, откуда пришёл вопрос", "Срочные случаи — наверху", "Заявки оформляет ассистент"].map((t) => (
              <li key={t} className="glass-chip rounded-2xl px-3 py-2 text-white/85">
                {t}
              </li>
            ))}
          </ul>
        </div>
        <p className="text-xs text-white/45">Фото: Alexis Antoine, Unsplash</p>
      </section>
      <section className="flex w-full items-center justify-center lg:p-6">
        <div className="glass-panel glass-rise w-full max-w-md space-y-8 p-8 sm:p-10" style={{ animationDelay: "120ms" }}>
          {org.logoUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={org.logoUrl} alt={org.name} className="h-10 w-auto brightness-0 invert lg:hidden" />
          )}
          <div className="space-y-1.5">
            <h2 className="text-2xl font-semibold tracking-tight text-white">Вход для команды фонда</h2>
            <p className="text-sm text-muted-foreground">Почта и пароль, которые выдал администратор.</p>
          </div>
          <Suspense>
            <LoginForm />
          </Suspense>
        </div>
      </section>
    </main>
  )
}
