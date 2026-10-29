import { NextResponse, type NextRequest } from "next/server"

/**
 * Быстрая проверка: без куки сессии страницы кабинета уводим на вход.
 * Настоящая проверка сессии — в API и на сервере; это только «оптимистичный» редирект.
 */
export function proxy(request: NextRequest) {
  if (!request.cookies.get("dom_session")) {
    const url = new URL("/login", request.url)
    if (request.nextUrl.pathname !== "/") url.searchParams.set("next", request.nextUrl.pathname + request.nextUrl.search)
    return NextResponse.redirect(url)
  }
  return NextResponse.next()
}

export const config = {
  matcher: ["/", "/inbox/:path*", "/dashboard/:path*", "/channels/:path*", "/contacts/:path*", "/settings/:path*", "/applications/:path*"],
}
