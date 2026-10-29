import type { Metadata } from "next"
import Script from "next/script"

export const metadata: Metadata = { title: "Пример страницы с чатом" }

/** Песочница виджета: так чат будет выглядеть на сайте фонда. /widget-demo?channel=<id канала> */
export default async function WidgetDemo({ searchParams }: PageProps<"/widget-demo">) {
  const { channel } = await searchParams
  const id = typeof channel === "string" && /^[0-9a-f-]{36}$/.test(channel) ? channel : null
  return (
    <main className="min-h-svh bg-white text-slate-900 [color-scheme:light]"><div className="mx-auto max-w-2xl space-y-4 p-10">
      <p className="text-sm text-slate-500">Пример страницы сайта фонда</p>
      <h1 className="text-3xl font-semibold">ДОМ — фонд помощи животным</h1>
      <p className="text-lg">Мы работаем, чтобы у каждой нуждающейся собаки и кошки был свой дом — постоянный или временный.</p>
      <p className="text-slate-600">
        Это демонстрационная страница. Кнопка чата в правом нижнем углу работает так же, как будет работать на настоящем сайте: сообщение сразу
        попадает во входящие платформы.
      </p>
      {!id && <p className="text-destructive">Добавьте к адресу ?channel=&lt;id канала «Чат на сайте»&gt;.</p>}
      {id && <Script src="/widget.js" data-channel={id} strategy="afterInteractive" />}
      </div>
    </main>
  )
}
