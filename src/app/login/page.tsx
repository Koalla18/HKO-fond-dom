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
    <main className="relative flex min-h-svh flex-col items-center overflow-hidden px-5 pt-[9vh] pb-16 text-white sm:pt-[11vh]">
      <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 bg-[#0a0d14]">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/scene/puppy.webp" alt="" className="h-full w-full object-cover object-[42%_100%] sm:object-[50%_0%]" />
        {/* Тень только под формой — щенок остаётся светлым по краям. */}
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_30%_40%_at_50%_34%,rgba(8,10,16,.8),rgba(8,10,16,.4)_62%,rgba(8,10,16,.08))] max-sm:bg-[linear-gradient(180deg,rgba(8,10,16,.82)_0%,rgba(8,10,16,.7)_55%,rgba(8,10,16,.1)_80%)]" />
      </div>

      <div className="w-full max-w-[340px]">
        {org.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={org.logoUrl} alt={org.name} className="mx-auto mb-7 h-12 w-auto brightness-0 invert" />
        ) : (
          <p className="mb-9 text-center text-lg font-semibold">{org.name}</p>
        )}
        <h1 className="mb-5 text-center text-[28px] font-semibold tracking-tight">Вход</h1>
        <Suspense>
          <LoginForm />
        </Suspense>
      </div>

      <footer className="absolute inset-x-0 bottom-0 flex flex-wrap items-end justify-between gap-2 px-5 pb-4 text-xs text-white/60 [text-shadow:0_1px_2px_rgb(0_0_0/0.6)]">
        <span>
          {org.name}
          {org.site && (
            <>
              {" · "}
              <a href={org.site} className="hover:text-white">
                {org.site.replace(/^https?:\/\//, "")}
              </a>
            </>
          )}
        </span>
        <span>Фото: Chris Leipelt, Unsplash</span>
      </footer>
    </main>
  )
}
